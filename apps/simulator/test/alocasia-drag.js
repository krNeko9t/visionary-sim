import { nativeDevice } from '../src/render/playcanvasInterop.js';
import { createApp } from '../src/scene/app.js';
import { createAlocasiaScene } from '../src/scene/alocasia.js';
import { readPly } from '../src/assets/splats/ply.js';
import { createMetricRegion } from '../src/scene/metricRegion.js';
import { Simulator } from 'visionary-sim/sim/simulator.js';
import { locate, trilinearWeights, trilinearGradients, evaluatePosition, evaluateDeformationGradient } from 'visionary-sim/sim/discretize/lattice/sample.js';
import { cellNodeIndices } from 'visionary-sim/sim/discretize/lattice/lattice.js';

// Real asset + real GPU kernels. Run a fixed amount of simulated time rather
// than a number of render frames (which used to make comparisons unequal).
const refs = [
    [0.0006921184, 0.0808527693, 0.0626744032],
    [0.0185582805, 0.1203747541, 0.0648067445],
    [0.0389226787, 0.1597682685, 0.0641679093],
    [0.0589896217, 0.1985706389, 0.0616112836],
    [0.0820937157, 0.2249957621, 0.0596146286],
    [0.1006892174, 0.2723406851, 0.0997410491],
    [0.1145914420, 0.2637784481, 0.1104702875]
];
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
function maximumStretch(f) {
    const apply = v => [0, 1, 2].map(r => f[r] * v[0] + f[3 + r] * v[1] + f[6 + r] * v[2]);
    let largest = 0;
    for (const seed of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
        let v = seed;
        for (let n = 0; n < 10; n++) {
            const fv = apply(v);
            const next = [0, 1, 2].map(c => f[c * 3] * fv[0] + f[c * 3 + 1] * fv[1] + f[c * 3 + 2] * fv[2]);
            const norm = Math.hypot(...next);
            if (norm === 0) break;
            v = next.map(x => x / norm);
        }
        largest = Math.max(largest, Math.hypot(...apply(v)));
    }
    return largest;
}
const app = await createApp(document.getElementById('app'));
app.start();
window.runDrag = async ({ h, delta = [0.04, 0, 0], material = {}, duration = 0.4, hold = 0.2, gripRadius, legacy = false } = {}) => {
    const scene = createAlocasiaScene({ r: 0.016 });
    const [{ body, render }] = await scene.createObjects();
    if (h !== undefined) body.elementSize = h;
    Object.assign(body.material, material);
    if (legacy) {
        const response = await fetch('/splats/alocasia/moving_part_points.ply');
        const { count, properties: p } = readPly(await response.arrayBuffer(), { properties: ['x', 'y', 'z'] });
        const samples = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) samples.set([p.x[i], p.y[i], p.z[i]], i * 3);
        body.staticRegion = createMetricRegion(samples, 0.016).staticRegion;
        body.material.maxStretch = 0;
        body.material.damping = 0.6;
    }
    const sim = new Simulator(nativeDevice(app.graphicsDevice), [body], scene.bounds);
    if (gripRadius !== undefined) sim.setGripRadius(gripRadius);
    if (!legacy) {
        sim.setDriveLaw(scene.grab.law);
        sim.setDriveResponseTime(scene.grab.responseTime);
    }
    sim.params.gravity = [0, 0, 0];
    const l = sim.simBodies[0].proxy.lattice;
    const bindings = refs.map(point => {
        const { cell, local } = locate(l, ...point);
        return { nodes: cellNodeIndices(l.nodeDims, ...cell), weights: trilinearWeights(local) };
    });
    // Local deformation distinguishes actual stretching from a curved leaf
    // unfolding (which can increase the end-to-end chord without stretching).
    const leafBindings = [];
    const cloud = render.cloud;
    for (let i = 0; i < cloud.count; i += 17) {
        const point = Array.from(cloud.positions.subarray(i * 3, i * 3 + 3));
        if (point[0] < 0.05 || point[1] < 0.21 || point[2] < 0.04 || distance(point, refs[6]) > 0.085) continue;
        const { cell, local } = locate(l, ...point);
        leafBindings.push({ nodes: cellNodeIndices(l.nodeDims, ...cell), gradients: trilinearGradients(local, l.h) });
    }
    const dt = sim.clock.stepDuration;
    const batch = steps => new Promise(resolve => app.once('update', () => {
        sim.dispatch(steps);
        app.once('postrender', resolve);
    }));
    const advance = async (seconds, move) => {
        const steps = Math.ceil(seconds / dt);
        for (let i = 0; i < steps; i += 24) {
            const n = Math.min(24, steps - i);
            move?.((i + n) / steps);
            await batch(n);
        }
    };
    const capture = async () => {
        const raw = await sim.readPositions();
        const positions = new Float32Array(raw.length / 4 * 3);
        let staticMax = 0, bad = 0;
        for (let i = 0; i < positions.length / 3; i++) {
            const point = Array.from(raw.subarray(i * 4, i * 4 + 3));
            positions.set(point, i * 3);
            if (!point.every(Number.isFinite)) bad++;
            if (sim.particles.staticPrescribed.has(i)) staticMax = Math.max(staticMax,
                distance(point, Array.from(sim.particles.restPositions.subarray(i * 4, i * 4 + 3))));
        }
        const xyz = bindings.map(({ nodes, weights }) => evaluatePosition(positions, nodes, weights));
        const stretches = leafBindings.map(({ nodes, gradients }) => maximumStretch(evaluateDeformationGradient(positions, nodes, gradients)))
            .sort((a, b) => a - b);
        return { xyz, mm: xyz.map((p, i) => distance(p, refs[i]) * 1000),
            leafLengthRatio: distance(xyz[4], xyz[6]) / distance(refs[4], refs[6]),
            stretch: { samples: stretches.length, p95: stretches[Math.floor(stretches.length * 0.95)], max: stretches.at(-1) },
            staticMax, bad };
    };
    try {
        await batch(1);
        const rest = await capture();
        // Same ray as the recorded failing drag; use public picking and grip.
        const origin = [0.48, 0.32, 0.60], point = refs[6];
        const vector = point.map((v, i) => v - origin[i]);
        const length = Math.hypot(...vector);
        const hit = await sim.grab(origin, vector.map(v => v / length));
        if (!hit) throw new Error('Regression ray did not hit the leaf');
        await advance(duration, t => sim.moveGrab(hit.position.map((v, i) => v + delta[i] * t)));
        await advance(hold);
        const held = await capture();
        sim.releaseGrab();
        await batch(1);
        const releaseStep = await capture();
        await advance(0.1);
        const release100ms = await capture();
        await advance(0.4);
        const release500ms = await capture();
        await advance(1.5);
        const release2000ms = await capture();
        return { h: body.elementSize, legacy, material: body.material, dt, hit, delta, rest, held, releaseStep, release100ms, release500ms, release2000ms };
    } finally { sim.destroy(); }
};
window.ready = true;
