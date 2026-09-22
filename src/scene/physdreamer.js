import { loadCloud } from '../assets/splats/cloud.js';
import { readPly } from '../assets/splats/ply.js';
import { preparePhysDreamerData, cleanPhysDreamerCloud, materialFailure } from './physdreamerData.js';
import { rawBounds } from '../assets/splats/measure.js';
import { SoftBody } from '../body/softBody.js';
import { createMetricRegion } from './metricRegion.js';

/**
 * Already transformed offline: no capture placement or second normalisation.
 * r is an explicit declaration in metres, independent of simulation resolution.
 * Callers must supply their calibrated tolerance; no fallback is inferred.
 * @param {object} declaration - Name, assetRoot, independent metric r/elementSize, material/grab, requireFixedMaterial.
 * @returns {import('./scenes.js').Scene} A scene sharing one preparation promise.
 */
export function createPhysDreamerScene(declaration) {
    // Snapshot caller-owned objects: another scene or later mutation cannot change this run.
    const { name, assetRoot, r, elementSize, requireFixedMaterial } = declaration;
    const material = { ...declaration.material }, grab = { ...declaration.grab };
    let prepared;
    let counts;
    const failure = (reason, material = {}) => new Error(
        `${name}: ${reason}; r=${r ?? 'unavailable'} m; ${JSON.stringify({ ...counts, ...material })}`
    );
    const prepare = () => prepared ??= (async () => {
        if (!name || !assetRoot || typeof requireFixedMaterial !== 'boolean') throw new Error('name, assetRoot and explicit requireFixedMaterial are required');
        if (!Number.isFinite(elementSize) || elementSize <= 0) throw new Error('elementSize must be positive metres');
        if (r === undefined) throw new Error('r is not calibrated; complete real-asset calibration before loading');
        // Validate even before I/O; no guessed tolerance is ever substituted.
        createMetricRegion([], r);
        const [raw, samples, rawBackground] = await Promise.all([
            loadCloud(`${assetRoot}/foreground.ply`),
            loadMovingPoints(`${assetRoot}/moving_part_points.ply`),
            loadCloud(`${assetRoot}/background.ply`)
        ]);
        const { cloud, region, movable, fixed } = preparePhysDreamerData(raw, samples, r);
        const background = cleanPhysDreamerCloud(rawBackground, 'background');
        counts = { inputForeground: raw.count, inputBackground: rawBackground.count,
            foregroundDiscarded: raw.count - cloud.count, backgroundDiscarded: rawBackground.count - background.count,
            backgroundGaussians: background.count, movingSamples: samples.length / 3, foreground: cloud.count,
            movableGaussians: movable.count, fixedGaussians: fixed.count };
        if (!samples.length) throw new Error('no moving samples');
        if (!cloud.count) throw new Error('no foreground after cleaning');
        const bounds = rawBounds(cloud);
        // Ten centimetres of interaction room on each side; the floor remains
        // the offline declaration y=0. Background never expands the solver box.
        scene.bounds = {
            min: [bounds.min[0] - 0.1, 0, bounds.min[2] - 0.1],
            max: [bounds.max[0] + 0.1, Math.max(0, bounds.max[1]) + 0.1, bounds.max[2] + 0.1]
        };
        scene.counts = counts;
        const backgroundBounds = rawBounds(background);
        scene.viewBounds = {
            min: bounds.min.map((v, axis) => Math.min(v, backgroundBounds.min[axis])),
            max: bounds.max.map((v, axis) => Math.max(v, backgroundBounds.max[axis]))
        };
        const report = `${name} r=${r} m; ${JSON.stringify(counts)}`;
        return {
            bodies: [new SoftBody({ name, source: { kind: 'cloud', cloud, report },
                render: movable.count ? { kind: 'gaussians', cloud: movable } : null,
                staticRegion: region.staticRegion, elementSize, material })],
            scenery: [
                ...(fixed.count ? [{ name: `${name}-fixed`, cloud: fixed }] : []),
                ...(background.count ? [{ name: `${name}-background`, cloud: background }] : [])
            ]
        };
    })().catch(error => { throw failure(error.message); });
    const scene = {
        name,
        bounds: null, // Available only after prepare; never frame a placeholder.
        gravity: [0, 0, 0],
        grab,
        decorate() {},
        prepare,
        createBodies: async () => (await prepare()).bodies,
        scenery: async () => (await prepare()).scenery,
        validateSimulation({ perBody }) {
            const material = perBody[0];
            const reason = materialFailure(material, requireFixedMaterial);
            if (reason) throw failure(reason, material);
        }
    };
    return scene;
}

async function loadMovingPoints(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`failed to fetch ${url}: ${response.status} ${response.statusText}`);
    const { count, properties: p } = readPly(await response.arrayBuffer(), { properties: ['x', 'y', 'z'] });
    const samples = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) samples.set([p.x[i], p.y[i], p.z[i]], i * 3);
    return samples;
}

