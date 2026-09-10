import {
    AppBase,
    AppOptions,
    CameraComponentSystem,
    ContainerHandler,
    FILLMODE_FILL_WINDOW,
    GSPLAT_RENDERER_RASTER_GPU_SORT,
    GSplatComponentSystem,
    LightComponentSystem,
    RESOLUTION_AUTO,
    RenderComponentSystem,
    ScriptComponentSystem,
    TextureHandler,
    WebgpuGraphicsDevice
} from 'playcanvas';

/** WebGPU API or adapter acquisition failed; engine failures retain their own type. */
export class WebGpuUnavailableError extends Error {
    constructor(reason, options) {
        super(reason, options);
        this.name = 'WebGpuUnavailableError';
    }
}

/**
 * Creates the application's WebGPU device without PlayCanvas's implicit WebGL2
 * fallback, which logs and swallows the original initialization exception.
 * A WGSL compute application must preserve that failure for diagnosis.
 */
export async function createApp(canvas) {
    if (!window.navigator.gpu) {
        throw new WebGpuUnavailableError('当前页面没有获得 navigator.gpu API');
    }
    const device = new WebgpuGraphicsDevice(canvas, {
        antialias: true,
        powerPreference: 'high-performance'
    });
    try {
        await device.initWebGpu();
    } catch (error) {
        // PlayCanvas destroy assumes its render helpers finished construction.
        // Native device destruction also releases allocations from partial init.
        destroyFailedDevice(device);
        if (device.gpuAdapter === null) {
            throw new WebGpuUnavailableError(
                'WebGPU requestAdapter 返回 null，未获得适配器；尚未进入渲染或模拟初始化',
                { cause: error }
            );
        }
        throw error;
    }

    let app;
    try {
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

        app = new AppBase(canvas);
        app.init(options);
        // WebGPU's GPU sorter reads the same work buffer the deformation modifier
        // writes. Make that data path explicit instead of relying on AUTO's current
        // engine-version default; the CPU sorter only sees the static resource
        // centres and would silently sort a moving body in its rest pose.
        app.scene.gsplat.renderer = GSPLAT_RENDERER_RASTER_GPU_SORT;
        app.setCanvasFillMode(FILLMODE_FILL_WINDOW);
        app.setCanvasResolution(RESOLUTION_AUTO);

        const onResize = () => app.resizeCanvas();
        window.addEventListener('resize', onResize);
        app.on('destroy', () => window.removeEventListener('resize', onResize));

        return app;
    } catch (error) {
        // init may fail before the caller can take ownership of the application.
        let appDestroyed = false;
        try { app?.destroy(); appDestroyed = !!app; } catch { /* partial app */ }
        destroyFailedDevice(device, appDestroyed);
        throw error;
    }
}

function destroyFailedDevice(device, engineDestroyed = false) {
    if (!engineDestroyed) {
        try { device.destroy(); } catch { /* partial engine construction */ }
    }
    // Engine destruction doesn't destroy the native GPUDevice. Releasing it
    // also covers GPU resources allocated before engine initialization failed.
    try { device.wgpu?.destroy(); } catch { /* preserve the initialization error */ }
}
