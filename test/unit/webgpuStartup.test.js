import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn(), fallback: vi.fn(), initApp: vi.fn(), destroyApp: vi.fn() }));
vi.mock('playcanvas', async (original) => ({
    ...await original(),
    WebgpuGraphicsDevice: class { constructor(...args) { return mocks.create(...args); } },
    createGraphicsDevice: mocks.fallback,
    AppBase: class {
        constructor() { this.scene = { gsplat: {} }; }
        init(...args) { mocks.initApp(...args); }
        destroy() { mocks.destroyApp(); }
        setCanvasFillMode() {}
        setCanvasResolution() {}
        on() {}
    }
}));
import { createApp, WebGpuUnavailableError } from '../../src/scene/app.js';

beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('window', { navigator: { gpu: {} }, addEventListener: vi.fn() });
    mocks.fallback.mockResolvedValue({ isWebGPU: false, deviceType: 'webgl2', destroy: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

describe('WebGPU application startup', () => {
    it('retains engine initialization failures instead of classifying them as unsupported WebGPU', async () => {
        const cause = new Error('shader initialization defect');
        const device = { gpuAdapter: {}, initWebGpu: vi.fn().mockRejectedValue(cause), destroy: vi.fn(), wgpu: { destroy: vi.fn() } };
        mocks.create.mockReturnValue(device);
        await expect(createApp({})).rejects.toBe(cause);
        expect(mocks.fallback).not.toHaveBeenCalled();
        expect(device.wgpu.destroy).toHaveBeenCalledOnce();
        expect(mocks.initApp).not.toHaveBeenCalled();
    });

    it('reports the observed null adapter without losing its original cause', async () => {
        const cause = new TypeError("Cannot read properties of null (reading 'features')");
        const device = { gpuAdapter: null, initWebGpu: vi.fn().mockRejectedValue(cause), destroy: vi.fn(() => { throw new Error('partial device'); }) };
        mocks.create.mockReturnValue(device);
        const error = await createApp({}).catch(error => error);
        expect(error).toBeInstanceOf(WebGpuUnavailableError);
        expect(error.message).toMatch(/requestAdapter.*null/);
        expect(error.cause).toBe(cause);
        expect(mocks.fallback).not.toHaveBeenCalled();
    });

    it('releases the device if application construction fails after GPU initialization', async () => {
        const cause = new Error('app component initialization defect');
        const device = { gpuAdapter: {}, initWebGpu: vi.fn().mockResolvedValue(undefined), destroy: vi.fn(), wgpu: { destroy: vi.fn() } };
        mocks.create.mockReturnValue(device);
        mocks.initApp.mockImplementation(() => { throw cause; });
        await expect(createApp({})).rejects.toBe(cause);
        expect(mocks.destroyApp).toHaveBeenCalledOnce();
        expect(device.wgpu.destroy).toHaveBeenCalledOnce();
    });

    it('reports a missing API before constructing any graphics device', async () => {
        window.navigator.gpu = undefined;
        await expect(createApp({})).rejects.toThrow(/navigator.gpu/);
        expect(mocks.create).not.toHaveBeenCalled();
        expect(mocks.fallback).not.toHaveBeenCalled();
    });

    it('initializes only a WebGPU device and publishes it after initialization', async () => {
        const device = { gpuAdapter: {}, initWebGpu: vi.fn().mockResolvedValue(undefined), destroy: vi.fn() };
        mocks.create.mockReturnValue(device);
        await createApp({});
        expect(device.initWebGpu).toHaveBeenCalledOnce();
        expect(mocks.initApp.mock.calls[0][0].graphicsDevice).toBe(device);
        expect(mocks.fallback).not.toHaveBeenCalled();
        expect(device.destroy).not.toHaveBeenCalled();
    });
});
