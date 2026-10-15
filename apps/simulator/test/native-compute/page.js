import { createApp } from '../../src/scene/app.js';
import { nativeDevice } from '../../src/render/playcanvasInterop.js';
import { sphere, translateShape } from '../../src/assets/shapes.js';
import { SoftBody } from 'visionary-sim/body/softBody.js';
import { Simulator } from 'visionary-sim/sim/simulator.js';

const result = window.computeGate = { done: false, errors: [], phases: [] };
window.addEventListener('error', event => result.errors.push(event.message));
window.addEventListener('unhandledrejection', event => result.errors.push(String(event.reason)));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const close = (a, b, tolerance, message) => assert(Math.abs(a - b) <= tolerance, `${message}: ${a} vs ${b}`);
const bounds = { min: [-2, -2, -2], max: [2, 2, 2] };
const body = (x = 0) => new SoftBody({
    name: 'synthetic sphere', source: { kind: 'shape', shape: translateShape(sphere({ radius: 0.08 }), [x, 0, 0]) }, elementSize: 0.04,
    material: { damping: 0, maxStretch: 1.1 }
});

let app, sim;
try {
    app = await createApp(document.querySelector('canvas'));
    const device = nativeDevice(app.graphicsDevice);
    result.adapter = device.adapterInfo;
    device.addEventListener('uncapturederror', event => result.errors.push(event.error.message));
    device.pushErrorScope('validation');
    // The host never starts a render loop. Stepping, grabbing and mapping must
    // submit their own commands, without waiting for an update/postrender.
    for (let iteration = 0; iteration < 3; iteration++) {
        sim = new Simulator(device, [body()], bounds);
        sim.setContact(false);
        const rest = await sim.readPositions();
        sim.params.paused = true;
        sim.requestStep();
        sim.step(0);
        const moved = await sim.readPositions();
        const dt = sim.stats().stepDuration;
        let maximumFall = 0;
        for (let i = 1; i < moved.length; i += 4) maximumFall = Math.max(maximumFall, rest[i] - moved[i]);
        close(maximumFall, 9.81 * dt * dt, 2e-7, 'one standalone step must integrate gravity');
        sim.reset();
        assert((await sim.readPositions()).every((v, i) => v === rest[i]), 'reset must restore exact rest positions');
        sim.params.gravity = [0, 0, 0];
        sim.setGrip('singleNode');
        const hit = await sim.grab([0, 0, 1], [0, 0, -1]);
        assert(hit, 'standalone readback must allow grabbing');
        const target = hit.position.map((v, i) => v + (i === 0 ? 0.02 : 0));
        sim.moveGrab(target);
        sim.setDriveLaw('hard');
        sim.dispatch(2);
        const hard = await sim.readPositions();
        let distance = Infinity;
        for (let i = 0; i < hard.length; i += 4) distance = Math.min(distance, Math.hypot(...target.map((v, axis) => v - hard[i + axis])));
        assert(distance < 1e-7, 'hard drive must reach the target');
        sim.setDriveLaw('compliant');
        sim.moveGrab(target.map((v, i) => v + (i === 1 ? 0.01 : 0)));
        sim.dispatch(4);
        const compliant = await sim.readPositions();
        assert(compliant.some((v, i) => v !== hard[i]), 'compliant and elastic passes must move nodes');
        assert(compliant.every(Number.isFinite), 'all paths must leave finite positions');
        sim.releaseGrab();
        sim.dispatch(4);
        sim.reset();
        assert((await sim.readPositions()).every((v, i) => v === rest[i]), 'reset after both drive laws must be exact');
        sim.destroy(); sim.destroy(); sim = null;
        result.phases.push({ name: `lifecycle-${iteration}`, maximumFall, dt });
    }
    // Two overlapping bodies make contact do observable work, not just compile.
    const compare = async enabled => {
        sim = new Simulator(device, [body(-0.04), body(0.04)], bounds);
        sim.params.gravity = [0, 0, 0];
        sim.setContact(enabled);
        sim.dispatch(8);
        const positions = await sim.readPositions();
        sim.destroy(); sim = null;
        return positions;
    };
    const without = await compare(false), withContact = await compare(true);
    assert(withContact.every(Number.isFinite), 'contact positions must remain finite');
    assert(withContact.some((v, i) => Math.abs(v - without[i]) > 1e-5), 'contact must separate overlapping bodies');
    result.phases.push({ name: 'contact', maximumChange: Math.max(...withContact.map((v, i) => Math.abs(v - without[i]))) });
    // Sim destruction must leave the borrowed device usable.
    const probe = device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(probe, 0, new Uint32Array([7]));
    await device.queue.onSubmittedWorkDone();
    probe.destroy();
    const error = await device.popErrorScope();
    if (error) result.errors.push(error.message);
} catch (error) {
    result.errors.push(error.stack ?? String(error));
} finally {
    sim?.destroy();
    app?.destroy();
    result.done = true;
}
