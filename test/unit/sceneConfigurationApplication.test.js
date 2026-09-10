import { Entity } from 'playcanvas';
import { describe, it, expect } from 'vitest';
import { SceneApplication } from '../../src/app/scene.js';
import { createPreparationConfig, fingerprintSourceFiles } from '../../src/app/preparationConfig.js';

const files = () => ({ geometry: new File(['abc'], 'scene.ply'), labels: new File(['labels'], 'labels.npz'), physics: new File(['physics'], 'physics.json') });
async function saved() {
    return createPreparationConfig({ sources: await fingerprintSourceFiles(files()),
        calibration: { upAxis: '+Z', manualDegrees: [10, 20, 30], longestMeters: 2, position: [4, 5, 6] },
        container: { position: [7, 8, 9], orientation: [0, 0, 0, 1], dimensions: [1, 2, 3] },
        materialOverrides: { 7: { density: 1200 } }, participantIds: [7, 42], instanceIds: [7, 42] });
}
function application({ storage, simulate = false } = {}) {
    const records = new Map();
    storage ??= { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) };
    let simulations = 0;
    const app = new SceneApplication({ canvas: {}, host: {}, browser: { addEventListener() {}, removeEventListener() {} },
        deps: {
            localStorage: storage,
            createEngine: async () => ({ graphicsDevice: {}, start() {}, destroy() {} }),
            createStage: () => ({ camera: {} }), createGroundGrid: () => ({ dispose() {} }),
            detectCapabilities: () => ({ available: true }),
            createImportTask: selected => ({ promise: fingerprintSourceFiles(selected).then(sources => ({
                sources, count: 4, untrackedCount: 0,
                instances: [7, 42].map(id => ({ id, name: `实例 ${id}`, count: 2,
                    material: { source: { rho_si: 800, E_si: 1e5, nu_si: 0.3 } } })),
                groups: [7, 42].map(id => ({ id, cloud: { count: 2, positions: new Float32Array([0, 0, 0, 2, 1, 0.5]) } }))
            })), cancel() {} }),
            createViews: (_engine, prepared) => ({ views: { root: new Entity(), groups: prepared.instances.map(({ id }) => ({ id, entity: {} })) }, attach() {}, dispose() {} }),
            mountImport: () => ({ element: {}, dispose() {} }), mountInspector: () => ({ element: {}, dispose() {} }),
            mountCalibration: () => ({ dispose() {} }), mountSimulationControls: () => ({ dispose() {} }),
            mountConfiguration: () => ({ storageHost: {}, dispose() {} }), mountLocalConfiguration: () => ({ dispose() {} }),
            attachNavigation: () => ({ selection: { invalidate() {} }, dispose() {} }), applyColors() {},
            createSimulationCandidate: async () => {
                simulations++;
                if (!simulate) throw new Error('test GPU preparation rejected');
                return { discard() {}, publish: async () => ({
                    getClock: () => 9.5, freeze: async () => {}, resume: async () => {},
                    dispose: async () => {}, returnToPreparation: async () => {},
                    velocity: [10, 20, 30], bodyId: 'opaque-runtime-id'
                }) };
            }
        } });
    return { app, storage, simulations: () => simulations };
}
describe('SceneApplication portable configuration integration', () => {
    it('exports authored preparation during simulation and preserves runtime on failed restoration', async () => {
        const { app } = application({ simulate: true });
        await app.start(); await app.importScene(files());
        app.setMaterialOverride(7, { density: 950 });
        app.selectInstance(7); await app.addSelectedToSimulation();
        expect(app.state().simulation.phase).toBe('running');
        const source = app.state().scene;
        const exported = app.configuration.exportConfiguration();
        expect(exported.participantIds).toEqual([7]);
        expect(exported.materialOverrides).toEqual({ 7: { density: 950 } });
        expect(JSON.stringify(exported)).not.toMatch(/bodyId|clock|velocity|runtime/);
        app.configuration.importConfiguration({ ...exported, participantIds: [999] });
        await expect(app.configuration.associateSources(files())).rejects.toThrow(/999/);
        expect(app.state().scene).toBe(source);
        expect(app.state().simulation.phase).toBe('running');
        expect(app.configuration.exportConfiguration()).toEqual(exported);
        app.destroy();
    });

    it('loads a local save into a fresh application and reconstructs preparation without a cache', async () => {
        const first = application();
        await first.app.start();
        first.app.configuration.importConfiguration(await saved());
        await first.app.configuration.associateSources(files());
        expect((await first.app.localConfiguration.saveLocal()).status).toBe('saved');
        const before = first.app.configuration.exportConfiguration();
        first.app.destroy();
        const next = application({ storage: first.storage });
        await next.app.start();
        await next.app.localConfiguration.loadLocal();
        expect(next.app.state().configuration.status).toBe('awaiting-sources');
        expect(next.app.state().scene).toBe(null);
        await next.app.configuration.associateSources(files());
        expect(next.app.configuration.exportConfiguration()).toEqual(before);
        expect(next.simulations()).toBe(0);
        expect(next.app.state().simulation.phase).toBe('preparation');
        next.app.destroy();
    });
    it('restores the whole preparation and list atomically, exports it and starts only on explicit action', async () => {
        const { app, simulations } = application();
        await app.start();
        const config = await saved();
        app.configuration.importConfiguration(config);
        expect(app.state().scene).toBe(null);
        const seen = [];
        const off = app.subscribe(state => { if (state.scene) seen.push(state); });
        await app.configuration.associateSources(files());
        expect(simulations()).toBe(0);
        expect(app.state().simulation).toMatchObject({ phase: 'preparation', participantIds: [7, 42], clock: 0 });
        expect(app.state().preparation.calibration).toEqual(config.calibration);
        expect(app.state().inspection.instances.find(value => value.id === 7).overrides).toEqual({ density: 1200 });
        expect(app.configuration.exportConfiguration()).toEqual(config);
        for (const state of seen) {
            expect(state.simulation.participantIds).toEqual([7, 42]);
            expect(state.preparation.calibration).toEqual(config.calibration);
        }
        await expect(app.simulation.start()).rejects.toThrow('test GPU preparation rejected');
        expect(simulations()).toBe(1);
        expect(app.state().simulation.phase).toBe('preparation');
        off(); app.destroy();
    });

    it('rejects invalid references and nonrepresentable geometry before replacing the current scene', async () => {
        const { app } = application();
        await app.start(); await app.importScene(files());
        app.setMaterialOverride(7, { density: 900 });
        const scene = app.state().scene;
        const config = await saved();
        app.configuration.importConfiguration({ ...config, participantIds: [123] });
        await expect(app.configuration.associateSources(files())).rejects.toThrow(/123/);
        expect(app.state().scene).toBe(scene);
        app.configuration.importConfiguration({ ...config, calibration: { ...config.calibration, longestMeters: 1e100 } });
        await expect(app.configuration.associateSources(files())).rejects.toThrow(/GPU/);
        expect(app.state().scene).toBe(scene);
        expect(app.state().inspection.instances.find(value => value.id === 7).overrides).toEqual({ density: 900 });
        app.destroy();
    });

    it('replaces mismatched files with fresh preparation instead of applying pending edits', async () => {
        const { app } = application();
        await app.start(); app.configuration.importConfiguration(await saved());
        const changed = files(); changed.physics = new File(['changed'], 'physics.json');
        await app.configuration.associateSources(changed);
        expect(app.state().simulation.participantIds).toEqual([]);
        expect(app.state().preparation.calibration.longestMeters).toBe(1);
        expect(app.state().inspection.instances[0].overrides).toEqual({});
        expect(app.state().configuration.status).toBe('new-scene');
        app.destroy();
    });
});
