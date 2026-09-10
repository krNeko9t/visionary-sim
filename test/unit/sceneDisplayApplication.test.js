import { Entity } from 'playcanvas';
import { describe, expect, it, vi } from 'vitest';
import { SceneApplication } from '../../src/app/scene.js';
import { createSceneDisplayCandidate } from '../../src/app/sceneDisplay.js';
import { applyInstanceColors } from '../../src/render/instanceColors.js';
import { createPreparationConfig, fingerprintSourceFiles } from '../../src/app/preparationConfig.js';

async function fixture() {
    const files = { geometry: new File(['geometry'], 'scene.ply'), labels: new File(['labels'], 'labels.npz'), physics: new File(['physics'], 'physics.json') };
    const sources = await fingerprintSourceFiles(files);
    const prepared = {
        sources, count: 2, untrackedCount: 0,
        reference: { center: [1, .5, .25], longestSide: 2, defaultMeters: 1 },
        instances: [{ id: 7, count: 2, material: { source: { rho_si: 800, E_si: 1e5, nu_si: .3 } } }],
        groups: [{ id: 7, cloud: { count: 2, positions: new Float32Array([0, 0, 0, 2, 1, .5]) } }]
    };
    const listeners = new Map(), candidates = [];
    let scopeError = null;
    const engine = {
        root: new Entity(), start() {}, destroy: vi.fn(),
        graphicsDevice: { wgpu: {
            pushErrorScope: vi.fn(), popErrorScope: vi.fn(async () => scopeError),
            queue: { onSubmittedWorkDone: vi.fn(async () => {}) }
        } },
        on(name, fn) { listeners.set(name, [...(listeners.get(name) ?? []), fn]); },
        off(name, fn) { listeners.set(name, (listeners.get(name) ?? []).filter(value => value !== fn)); },
        fire(name) { for (const fn of [...(listeners.get(name) ?? [])]) fn(); }
    };
    const colors = vi.fn(applyInstanceColors);
    const runtime = { getClock: () => 3, dispose: vi.fn(), freeze: vi.fn(), resume: vi.fn() };
    const app = new SceneApplication({ canvas: {}, host: {}, browser: { addEventListener() {}, removeEventListener() {} }, deps: {
        createEngine: async () => engine,
        createStage: () => ({ camera: {} }), createGroundGrid: () => ({ dispose() {} }),
        detectCapabilities: () => ({ available: true }),
        createImportTask: () => ({ promise: Promise.resolve(prepared), cancel() {} }),
        createViews: (app, prepared, options) => createSceneDisplayCandidate(app, prepared, { ...options, createViews() {
            const root = new Entity(); root.setLocalScale(.5, .5, .5);
            const parameters = new Map(), resource = { workBufferRenderInfos: new Map() };
            const raw = { root, parameters, resource,
                views: { root, groups: [{ id: 7, entity: { gsplat: { resource, setWorkBufferModifier() {}, setParameter: (key, value) => parameters.set(key, value) } } }] },
                attach() { engine.root.addChild(root); }, dispose: vi.fn(() => root.destroy()) };
            candidates.push(raw);
            return raw;
        } }),
        applyColors: colors,
        mountImport: () => ({ element: {}, dispose() {} }), mountInspector: () => ({ element: {}, dispose() {} }),
        mountCalibration: () => ({ dispose() {} }), attachNavigation: () => ({ selection: { invalidate() {} }, dispose() {} }),
        createSimulationCandidate: async () => ({ publish: async () => runtime, discard() {} })
    } });
    await app.start();
    async function beginFrame() {
        await vi.waitFor(() => expect(listeners.get('update')?.length).toBeGreaterThan(0));
        engine.fire('update');
        return candidates.at(-1);
    }
    function finishFrame(raw) {
        raw.resource.workBufferRenderInfos.set('real-path', { quadRender: { shader: { ready: true } } });
        engine.fire('frameend');
    }
    return { app, engine, files, sources, colors, runtime, candidates, listeners, beginFrame, finishFrame,
        failGpu() { scopeError = { message: 'source texture validation failed' }; } };
}

describe('production source display wiring', () => {
    it('returns one destroy promise and waits for source scope closure before destroying the engine', async () => {
        const f = await fixture();
        let closeScopes;
        const closing = new Promise(resolve => { closeScopes = resolve; });
        f.engine.graphicsDevice.wgpu.popErrorScope.mockImplementation(() => closing);
        const pending = f.app.importScene(f.files);
        const rejected = expect(pending).rejects.toThrow();
        await f.beginFrame();
        const destroyed = f.app.destroy();
        expect(destroyed).toBeInstanceOf(Promise);
        expect(f.app.destroy()).toBe(destroyed);
        expect(f.app.state().phase).toBe('destroyed');
        expect(f.engine.destroy).not.toHaveBeenCalled();
        closeScopes(null);
        await Promise.all([destroyed, rejected]);
        expect(f.engine.destroy).toHaveBeenCalledOnce();
        expect(f.candidates[0].dispose).toHaveBeenCalledOnce();
    });
    it('validates normal import before publication and waits beyond a frame without a workbuffer draw', async () => {
        const f = await fixture();
        const pending = f.app.importScene(f.files);
        const raw = await f.beginFrame();
        expect(raw.parameters.get('sourceDisplayProbe')).toBe(1);
        expect(raw.parameters.get('inspectionMix')).toBe(0);
        f.engine.fire('frameend');
        await Promise.resolve();
        expect(f.app.state().scene).toBe(null);
        expect(f.engine.graphicsDevice.wgpu.popErrorScope).not.toHaveBeenCalled();
        f.finishFrame(raw);
        await pending;
        expect(f.app.state().scene.views).toBe(raw.views);
        expect(raw.parameters.get('sourceDisplayProbe')).toBe(0);
        expect(f.listeners.get('update')).toEqual([]);
        expect(f.listeners.get('frameend')).toEqual([]);
        f.app.destroy();
    });

    it.each(['failure', 'cancel'])('probes final configuration and preserves the old running scene on %s', async mode => {
        const f = await fixture();
        const initial = f.app.importScene(f.files);
        f.finishFrame(await f.beginFrame()); await initial;
        f.app.selectInstance(7); await f.app.addSelectedToSimulation();
        const oldScene = f.app.state().scene;
        const config = createPreparationConfig({ sources: f.sources,
            calibration: { upAxis: '+Z', manualDegrees: [10, 20, 30], longestMeters: 4, position: [4, 5, 6] },
            container: { position: [7, 8, 9], orientation: [0, 0, 0, 1], dimensions: [1, 2, 3] },
            materialOverrides: { 7: { density: 1200 } }, participantIds: [7], instanceIds: [7] });
        f.app.configuration.importConfiguration(config);
        const pending = f.app.configuration.associateSources(f.files);
        const rejection = expect(pending).rejects.toThrow();
        const raw = await f.beginFrame();
        expect(raw.root.getLocalScale().x).toBe(2);
        expect(f.colors.mock.calls.at(-1)[1].instances[0].effectiveMaterial.density).toBe(1200);
        expect(raw.parameters.get('sourceDisplayProbe')).toBe(1);
        expect(f.app.state().scene).toBe(oldScene);
        if (mode === 'cancel') f.app.configuration.cancel();
        else { f.failGpu(); f.finishFrame(raw); }
        await rejection;
        expect(f.app.state().scene).toBe(oldScene);
        expect(f.app.state().simulation.phase).toBe('running');
        expect(f.runtime.dispose).not.toHaveBeenCalled();
        expect(raw.dispose).toHaveBeenCalledOnce();
        expect(f.candidates[0].dispose).not.toHaveBeenCalled();
        expect(f.listeners.get('update')).toEqual([]);
        expect(f.listeners.get('frameend')).toEqual([]);
        expect(f.engine.graphicsDevice.wgpu.popErrorScope).toHaveBeenCalledTimes(4);
        f.app.destroy();
    });
});
