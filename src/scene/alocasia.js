import { loadCloud } from '../assets/splats/cloud.js';
import { readPly } from '../assets/splats/ply.js';
import { prepareAlocasiaData } from './alocasiaData.js';
import { rawBounds } from '../assets/splats/measure.js';
import { SoftBody } from '../body/softBody.js';
import { createMetricRegion } from './metricRegion.js';

/**
 * Already transformed offline: no capture placement or second normalisation.
 * r is a declaration in metres, independent of simulation resolution. Production
 * must leave it absent until real-asset calibration (ticket 07) supplies evidence.
 * Tests may declare a tolerance for their own synthetic assets.
 * @param {{r?: number}} [declaration] - Calibrated asset declaration.
 * @returns {import('./scenes.js').Scene} A scene sharing one preparation promise.
 */
export function createAlocasiaScene({ r } = {}) {
    let prepared;
    let counts;
    const failure = (reason, material = {}) => new Error(
        `alocasia: ${reason}; r=${r ?? 'unavailable'} m; ${JSON.stringify({ ...counts, ...material })}`
    );
    const prepare = () => prepared ??= (async () => {
        if (r === undefined) throw failure('r is not calibrated; complete real-asset calibration before loading');
        // Validate even before I/O; no guessed tolerance is ever substituted.
        createMetricRegion([], r);
        const [raw, samples] = await Promise.all([
            loadCloud('/splats/alocasia/foreground.ply'),
            loadMovingPoints('/splats/alocasia/moving_part_points.ply')
        ]);
        const { cloud, region, movable, fixed } = prepareAlocasiaData(raw, samples, r);
        counts = { movingSamples: samples.length / 3, foreground: cloud.count,
            movableGaussians: movable.count, fixedGaussians: fixed.count };
        if (!samples.length) throw failure('no moving samples');
        if (!cloud.count) throw failure('no foreground after cleaning');
        const bounds = rawBounds(cloud);
        // Ten centimetres of interaction room on each side; the floor remains
        // the offline declaration y=0. Camera and solver consume this same box.
        scene.bounds = {
            min: [bounds.min[0] - 0.1, 0, bounds.min[2] - 0.1],
            max: [bounds.max[0] + 0.1, Math.max(0, bounds.max[1]) + 0.1, bounds.max[2] + 0.1]
        };
        return {
            bodies: [new SoftBody({ name: 'alocasia', source: { kind: 'cloud', cloud },
                render: movable.count ? { kind: 'gaussians', cloud: movable } : null,
                staticRegion: region.staticRegion, elementSize: 0.016 })],
            scenery: fixed.count ? [{ name: 'alocasia-fixed', cloud: fixed }] : []
        };
    })();
    const scene = {
        name: 'alocasia',
        bounds: null, // Available only after prepare; never frame a placeholder.
        gravity: [0, 0, 0],
        decorate() {},
        prepare,
        createBodies: async () => (await prepare()).bodies,
        scenery: async () => (await prepare()).scenery,
        validateSimulation({ perBody }) {
            const material = perBody[0];
            if (!material || !material.materialNodes) throw failure('no material nodes', material);
            if (!material.staticNodes) throw failure('no fixed material support', material);
            if (!material.movableNodes) throw failure('all material nodes are static', material);
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

export const alocasiaScene = createAlocasiaScene();
