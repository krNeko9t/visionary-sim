import {
    AppBase,
    AppOptions,
    CameraComponentSystem,
    ContainerHandler,
    DEVICETYPE_WEBGPU,
    FILLMODE_FILL_WINDOW,
    GSplatComponentSystem,
    LightComponentSystem,
    RESOLUTION_AUTO,
    RenderComponentSystem,
    ScriptComponentSystem,
    TextureHandler,
    createGraphicsDevice
} from 'playcanvas';

/** Raised when the browser cannot provide a WebGPU device. */
export class WebGpuUnavailableError extends Error {
    constructor(reason) {
        super(reason);
        this.name = 'WebGpuUnavailableError';
    }
}

/**
 * Creates the PlayCanvas application on a WebGPU device.
 *
 * The simulation is nothing but WGSL compute shaders, which WebGL2 cannot run,
 * so a fallback device is worse than no device: it would render fine and then
 * fail at the first dispatch. `createGraphicsDevice` unconditionally appends
 * WebGL2 and null devices to whatever `deviceTypes` asks for, so a resolved
 * promise is not proof that we got WebGPU -- check the device itself.
 *
 * @param {HTMLCanvasElement} canvas - Canvas to render into.
 * @returns {Promise<AppBase>} The initialised, not yet started, application.
 */
export async function createApp(canvas) {
    let device;
    try {
        device = await createGraphicsDevice(canvas, {
            deviceTypes: [DEVICETYPE_WEBGPU],
            antialias: true,
            powerPreference: 'high-performance'
        });
    } catch (err) {
        throw new WebGpuUnavailableError(`no graphics device at all: ${err.message}`);
    }

    if (!device.isWebGPU) {
        device.destroy();
        throw new WebGpuUnavailableError(`fell back to a "${device.deviceType}" device`);
    }

    const options = new AppOptions();
    options.graphicsDevice = device;
    // Systems are registered rather than pulled in by a bundle, so each one is
    // here because something draws with it: meshes, the camera, the lights, the
    // camera controls, and Gaussian clouds.
    options.componentSystems = [
        RenderComponentSystem,
        CameraComponentSystem,
        LightComponentSystem,
        ScriptComponentSystem,
        GSplatComponentSystem
    ];
    options.resourceHandlers = [TextureHandler, ContainerHandler];

    const app = new AppBase(canvas);
    app.init(options);
    app.setCanvasFillMode(FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(RESOLUTION_AUTO);

    const onResize = () => app.resizeCanvas();
    window.addEventListener('resize', onResize);
    app.on('destroy', () => window.removeEventListener('resize', onResize));

    return app;
}
