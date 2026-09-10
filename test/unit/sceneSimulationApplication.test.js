import { Entity } from 'playcanvas';
import { describe, expect, it, vi } from 'vitest';

import { SceneApplication } from '../../src/app/scene.js';

function fixture() {
    let prepared;
    let candidateOptions;
    const sourceEntity = { enabled: true, gsplat: {} };
    const root = new Entity();
    const runtime = {
        metrics: [{ instanceId: 7, resolution: 16, volume: 0.1, mass: 80 }],
        freeze: vi.fn(async () => {}), resume: vi.fn(async () => {}),
        returnToPreparation: vi.fn(async () => {}), setMaterial: vi.fn(),
        getClock: vi.fn(() => 0), subscribeClock: vi.fn(() => () => {})
    };
    const publish = vi.fn(async () => runtime);
    const application = new SceneApplication({
        canvas: {}, host: {}, browser: { addEventListener() {}, removeEventListener() {} },
        deps: {
            createEngine: async () => ({ graphicsDevice: {}, start() {}, destroy() {} }),
            createStage: () => ({ camera: {}, controls: {} }),
            createGroundGrid: () => ({ dispose() {} }), detectCapabilities: () => ({ available: true }),
            createImportTask: () => ({ promise: Promise.resolve(prepared), cancel() {} }),
            createViews: () => ({
                views: { root, groups: [{ id: 7, entity: sourceEntity }] }, attach() {}, dispose() {}
            }),
            mountImport: () => ({ element: {}, dispose() {} }),
            mountInspector: () => ({ element: {}, dispose() {} }),
            mountCalibration: () => ({ dispose() {} }),
            attachNavigation: () => ({ selection: { invalidate: vi.fn() }, dispose() {} }),
            applyColors() {},
            createSimulationCandidate: vi.fn(async options => {
                candidateOptions = options;
                return { publish, discard: vi.fn() };
            })
        }
    });
    return {
        application, runtime, publish,
        setPrepared(value) { prepared = value; },
        candidateOptions: () => candidateOptions
    };
}

describe('SceneApplication simulation operations', () => {
    it('adds the selected eligible instance, locks preparation and applies later material edits in place', async () => {
        const f = fixture();
        const material = { rho_si: 800, E_si: 1e5, nu_si: 0.3 };
        f.setPrepared({
            count: 2, untrackedCount: 0,
            instances: [{ id: 7, name: 'sheet', count: 2, material: { source: material } }],
            groups: [{
                id: 7, name: 'sheet', count: 2,
                cloud: { count: 2, positions: new Float32Array([0, 0, 0, 1, 1, 1]) }
            }]
        });
        await f.application.start();
        await f.application.importScene({});
        f.application.selectInstance(7);
        await f.application.addSelectedToSimulation();

        expect(f.candidateOptions()).toMatchObject({
            participantIds: [7], scene: expect.any(Object), reference: expect.any(Object)
        });
        expect(f.publish).toHaveBeenCalledWith(expect.objectContaining({ materials: {
            7: { density: 800, youngsModulus: 1e5, poissonRatio: 0.3 }
        } }));
        expect(f.application.state()).toMatchObject({
            preparationPhase: 'running', preparationEditable: false,
            simulation: { phase: 'running', participantIds: [7], metrics: f.runtime.metrics }
        });

        f.application.setMaterialOverride(7, { density: 900 });
        await Promise.resolve();
        expect(f.runtime.setMaterial).toHaveBeenLastCalledWith(7,
            { density: 900, youngsModulus: 1e5, poissonRatio: 0.3 });
        await f.application.pauseSimulation();
        expect(f.runtime.freeze).toHaveBeenCalledOnce();
        await f.application.resumeSimulation();
        expect(f.runtime.resume).toHaveBeenCalledOnce();
        f.application.destroy();
    });

    it('waits for an aborted GPU candidate to drain before destroying the engine', async () => {
        let finish;
        const active = new Promise(resolve => { finish = resolve; });
        const engine = { destroy: vi.fn() };
        const application = new SceneApplication({
            canvas: {}, host: {},
            browser: { addEventListener() {}, removeEventListener() {} }
        });
        application.phase = 'running';
        application.engine = engine;
        application.simulation = {
            active: { promise: active },
            dispose: vi.fn(() => Promise.resolve())
        };

        const destroyed = application.destroy();
        expect(engine.destroy).not.toHaveBeenCalled();
        finish();
        await active;
        await destroyed;
        expect(engine.destroy).toHaveBeenCalledOnce();
    });
});
