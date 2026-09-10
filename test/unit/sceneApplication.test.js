import { describe, expect, it, vi } from 'vitest';

import { SceneApplication } from '../../src/app/scene.js';

describe('the scene application wiring', () => {
    it('awaits and releases an engine that arrives after destroy during startup', async () => {
        let deliver, release;
        const arriving = new Promise(resolve => { deliver = resolve; });
        const releasing = new Promise(resolve => { release = resolve; });
        const engine = { destroy: vi.fn(() => releasing) };
        const application = new SceneApplication({ canvas: {}, host: {},
            browser: { addEventListener() {}, removeEventListener() {} },
            deps: { createEngine: () => arriving } });
        const starting = application.start();
        const rejected = expect(starting).rejects.toThrow(/ended during startup/);
        const destroyed = application.destroy();
        expect(application.destroy()).toBe(destroyed);
        deliver(engine);
        await vi.waitFor(() => expect(engine.destroy).toHaveBeenCalledOnce());
        release();
        await Promise.all([destroyed, rejected]);
        expect(application.engine).toBe(null);
        expect(application.state().phase).toBe('destroyed');
    });
    it('keeps startup pending until failure cleanup completes, preventing an overlapping retry', async () => {
        let release;
        const cleanup = new Promise(resolve => { release = resolve; });
        const engine = { destroy: vi.fn(() => cleanup) };
        const createEngine = vi.fn(async () => engine);
        const application = new SceneApplication({ canvas: {}, host: {},
            browser: { addEventListener() {}, removeEventListener() {} }, deps: {
                createEngine, createStage() { throw new Error('stage failed'); }
            } });
        const starting = application.start();
        const rejected = expect(starting).rejects.toThrow('stage failed');
        await vi.waitFor(() => expect(engine.destroy).toHaveBeenCalledOnce());
        expect(application.state().phase).toBe('starting');
        expect(application.start()).toBe(starting);
        expect(createEngine).toHaveBeenCalledOnce();
        release(); await rejected;
        expect(application.state().phase).toBe('failed');
        await application.destroy();
    });
    it('publishes a prepared candidate through its public operation and owns cleanup', async () => {
        let resolvePreparation;
        const candidate = { views: { root: {}, groups: [] }, attach: vi.fn(), dispose: vi.fn() };
        const engine = { graphicsDevice: { isWebGPU: true }, start: vi.fn(), destroy: vi.fn() };
        const browser = { Worker: class {}, File: class {}, Blob: class {}, DecompressionStream: class {}, addEventListener: vi.fn(), removeEventListener: vi.fn() };
        const application = new SceneApplication({
            canvas: {}, host: {}, browser,
            deps: {
                createEngine: async () => engine,
                createStage: () => ({ camera: {} }),
                createGroundGrid: () => ({ dispose: vi.fn() }),
                detectCapabilities: () => ({ available: true, missing: [] }),
                createImportTask: () => ({
                    promise: new Promise(resolve => { resolvePreparation = resolve; }),
                    cancel: vi.fn()
                }),
                createViews: () => candidate,
                mountImport: () => ({ dispose: vi.fn() }),
                mountInspector: () => ({ element: {}, dispose: vi.fn() }),
                attachNavigation: () => ({ selection: { invalidate: vi.fn() }, dispose: vi.fn() }),
                applyColors: vi.fn(),
                mountCalibration: () => ({ dispose: vi.fn() })
            }
        });
        await application.start();
        const imported = application.importScene({});
        resolvePreparation({ count: 3, instances: [], groups: [], reference: {} });
        await imported;
        expect(application.state()).toMatchObject({ phase: 'running', import: { status: 'ready' } });
        expect(candidate.attach).toHaveBeenCalledOnce();
        await application.destroy();
        expect(candidate.dispose).toHaveBeenCalledOnce();
        expect(engine.destroy).toHaveBeenCalledOnce();
    });
});
