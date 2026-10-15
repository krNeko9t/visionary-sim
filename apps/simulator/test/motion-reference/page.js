import { createApp } from '../../src/scene/app.js';
import { sceneNamed } from '../../src/scene/scenes.js';
import { BATCH, SCENARIOS } from './scenarios.js';
import { openSimulation } from './simulatorAdapter.js';

/**
 * The browser half of the motion reference: plays one scenario from
 * `scenarios.js` on a real WebGPU device and hands back what it recorded.
 * `run.mjs` drives it over the DevTools protocol.
 */

/** @param {Float32Array} positions - Floats. @returns {string} Their bytes, base64. */
const base64 = positions => {
    const bytes = new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength);
    let text = '';
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(text);
};

const app = await createApp(document.getElementById('app'));
app.start();

/**
 * @param {string} name - A key of SCENARIOS.
 * @returns {Promise<object>} `{ scenario, dt, checkpoints: [{ step, positions }] }`,
 *   positions as base64 little-endian float32, xyz per node.
 */
window.playScenario = async (name) => {
    const { scene: sceneName, script } = SCENARIOS[name];
    const scene = sceneNamed(sceneName);
    await scene.prepare?.();
    const simulation = openSimulation(app, scene, (await scene.createObjects()).map(({ body }) => body));
    try {
        const checkpoints = [];
        let step = 0;
        let held = null;
        for (const [action, args] of script) {
            if (action === 'record') {
                checkpoints.push({ step, positions: base64(await simulation.readNodes()) });
            } else if (action === 'run') {
                await simulation.advance(args, BATCH);
                step += args;
            } else if (action === 'grab') {
                const vector = args.toward.map((v, i) => v - args.origin[i]);
                const length = Math.hypot(...vector);
                const hit = await simulation.grab(args.origin, vector.map(v => v / length));
                if (!hit) throw new Error(`${name}: the grab ray hit nothing`);
                held = hit.position;
            } else if (action === 'drag') {
                const from = held;
                await simulation.advance(args.steps, BATCH,
                    done => simulation.moveGrab(from.map((v, i) => v + args.by[i] * done / args.steps)));
                held = from.map((v, i) => v + args.by[i]);
                step += args.steps;
            } else if (action === 'release') {
                simulation.release();
            } else {
                throw new Error(`${name}: unknown script line "${action}"`);
            }
        }
        return { scenario: name, dt: simulation.dt, checkpoints };
    } finally {
        simulation.destroy();
    }
};
/** @returns {object} The WebGPU adapter this page's device came from. */
window.adapterInfo = () => {
    const { vendor, architecture, device, description } = app.graphicsDevice.gpuAdapter.info;
    return { vendor, architecture, device, description };
};
window.ready = true;
