// Install observers before importing/creating the host, including its own scopes.
const errors = [];
window.smoke = { errors, phases: [], done: false };
addEventListener('error', event => errors.push(event.message ?? `Resource failed: ${event.target.src}`), true);
addEventListener('unhandledrejection', event => errors.push(String(event.reason?.stack ?? event.reason)));
const consoleError = console.error.bind(console);
console.error = (...args) => { errors.push(args.map(String).join(' ')); consoleError(...args); };
const requestDevice = GPUAdapter.prototype.requestDevice;
GPUAdapter.prototype.requestDevice = async function (...args) {
    const device = await requestDevice.apply(this, args);
    device.addEventListener('uncapturederror', event => errors.push(event.error.message));
    const pop = device.popErrorScope.bind(device);
    device.popErrorScope = async () => {
        const error = await pop();
        if (error) errors.push(error.message);
        return error;
    };
    return device;
};

try {
    const { Color, Entity, FILLMODE_NONE, PROJECTION_ORTHOGRAPHIC, RESOLUTION_FIXED, TONEMAP_NONE } = await import('playcanvas');
    const { createApp } = await import('../../src/scene/app.js');
    const { createSplatView } = await import('../../src/render/splats.js');
    const { nativeDevice, attachNativeSplatModifier } = await import('../../src/render/playcanvasInterop.js');
    const canvas = document.getElementById('app');
    const app = await createApp(canvas);
    app.setCanvasFillMode(FILLMODE_NONE, 320, 240);
    app.setCanvasResolution(RESOLUTION_FIXED, 320, 240);
    const device = nativeDevice(app.graphicsDevice);
    device.lost.then(info => { if (info.reason !== 'destroyed') errors.push(`Device lost: ${info.message}`); });
    device.pushErrorScope('validation');
    const input = device.createBuffer({ label: 'native-smoke-input', size: 16,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
    const camera = new Entity('camera');
    camera.addComponent('camera', { projection: PROJECTION_ORTHOGRAPHIC, orthoHeight: 2,
        clearColor: new Color(0, 0, 0), nearClip: 0.1, farClip: 20 });
    camera.camera.toneMapping = TONEMAP_NONE;
    camera.setPosition(0, 0, 5);
    app.root.addChild(camera);
    const view = createSplatView(app, 'native-smoke', {
        // NVIDIA's OneSweep sorter requires at least a vec4 of keys. The last
        // two splats are invisible padding, not additional visual assertions.
        count: 4,
        positions: new Float32Array([-0.8, 0, 0.35, -0.8, 0, -0.35, 0, 3, 0, 0, -3, 0]),
        rotations: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
        scales: new Float32Array(12).fill(0.22),
        opacity: new Float32Array([0.95, 0.95, 0, 0]),
        colors: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0])
    });
    app.root.addChild(view);
    const detach = attachNativeSplatModifier(view.gsplat, `
        var<storage, read> nativeInput: array<vec4f>;
        fn modifySplatCenter(center: ptr<function, vec3f>) {
            (*center).x += nativeInput[0].x;
            (*center).z *= nativeInput[0].w;
        }
        fn modifySplatRotationScale(originalCenter: vec3f, modifiedCenter: vec3f,
            rotation: ptr<function, vec4f>, scale: ptr<function, vec3f>) {}
        fn modifySplatColor(center: vec3f, color: ptr<function, vec4f>) {}
    `, { nativeInput: input });

    // Each write occurs in update, immediately before the real host render.
    // Sample synchronously at frameend: WebGPU canvas contents expire afterwards.
    function frame(name, values) {
        return new Promise(resolve => {
            app.once('update', () => {
                if (values) device.queue.writeBuffer(input, 0, new Float32Array(values));
            });
            app.once('frameend', () => {
                const copy = document.createElement('canvas');
                copy.width = 320; copy.height = 240;
                const context = copy.getContext('2d');
                context.drawImage(canvas, 0, 0);
                const pixel = x => Array.from(context.getImageData(x, 120, 1, 1).data);
                resolve({ name, left: pixel(112), right: pixel(208), image: copy.toDataURL() });
            });
        });
    }
    function check(phase, side, color) {
        const front = phase[side], back = phase[side === 'left' ? 'right' : 'left'];
        const dominant = color === 'red' ? 0 : 1, other = 1 - dominant;
        if (!(front[dominant] > 100 && front[dominant] - front[other] > 80 && back.slice(0, 3).every(v => v < 12))) {
            throw new Error(`${phase.name}: expected ${color} at ${side}, black opposite; got ${JSON.stringify({ left: phase.left, right: phase.right })}`);
        }
    }
    app.start();
    try {
        // Allow resource placement/pipeline creation to settle before assertions.
        for (let i = 0; i < 8; i++) await frame('warmup', [0, 0, 0, 1]);
        for (const [name, values, side, color] of [
            ['rest', [0, 0, 0, 1], 'left', 'red'],
            ['translated', [1.6, 0, 0, 1], 'right', 'red'],
            ['depth-reversed', [1.6, 0, 0, -1], 'right', 'green'],
            ['updated-back', [0, 0, 0, 1], 'left', 'red']
        ]) {
            const phase = await frame(name, values);
            smoke.phases.push(phase);
            check(phase, side, color);
        }
        detach();
        detach();
        // Detaching must leave the caller's native buffer and device usable.
        const readback = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        try {
            device.queue.writeBuffer(input, 0, new Float32Array([7, 8, 9, 10]));
            const commands = device.createCommandEncoder();
            commands.copyBufferToBuffer(input, 0, readback, 0, 16);
            device.queue.submit([commands.finish()]);
            await readback.mapAsync(GPUMapMode.READ);
            smoke.afterDetach = Array.from(new Float32Array(readback.getMappedRange()));
            if (smoke.afterDetach.join(',') !== '7,8,9,10') throw new Error('Detach invalidated the borrowed buffer');
            readback.unmap();
        } finally {
            readback.destroy();
        }
        input.destroy();
        const restored = await frame('detached');
        smoke.phases.push(restored);
        check(restored, 'left', 'red');
        view.destroy();
        const removed = await frame('removed');
        smoke.phases.push(removed);
        if (![...removed.left, ...removed.right].every((v, i) => i % 4 === 3 || v < 12)) {
            throw new Error('Removing the scene did not clear the splats');
        }
        await device.queue.onSubmittedWorkDone();
    } finally {
        detach();
        view.destroy();
        input.destroy();
        await device.queue.onSubmittedWorkDone();
        await device.popErrorScope();
        // App owns the host device; destroy only after unbinding and draining.
        app.destroy();
    }
    await new Promise(resolve => setTimeout(resolve, 100));
} catch (error) {
    errors.push(error.stack ?? String(error));
} finally {
    smoke.done = true;
}
