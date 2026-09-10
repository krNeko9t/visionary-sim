import { describe, it, expect } from 'vitest';
import { createSceneConfiguration, prepareSourceConfiguration } from '../../src/app/sceneConfiguration.js';
import { createPreparationConfig, fingerprintSourceFiles } from '../../src/app/preparationConfig.js';
import { SceneSession } from '../../src/app/sceneSession.js';

const files = () => ({ geometry: new File(['abc'], 'scene.ply'), labels: new File(['labels'], 'labels.npz'), physics: new File(['physics'], 'physics.json') });
async function config() {
    return createPreparationConfig({ sources: await fingerprintSourceFiles(files()),
        calibration: { upAxis: '+Z', manualDegrees: [10, 20, 30], longestMeters: 2, position: [4, 5, 6] },
        container: { position: [7, 8, 9], orientation: [0, 0, 0, 1], dimensions: [1, 2, 3] },
        materialOverrides: { 7: { density: 1200 } }, participantIds: [7, 42], instanceIds: [7, 42] });
}

async function setup({ ids = [7, 42], stageError = false } = {}) {
    const original = await config();
    let current = original;
    const released = [];
    const session = new SceneSession({
        prepareTask: selected => ({ promise: fingerprintSourceFiles(selected).then(sources => ({ sources })), cancel() {} }),
        createViews: () => ({ views: {}, attach() {}, dispose() { released.push(true); } })
    });
    await session.importScene(files());
    const oldScene = session.getState().scene;
    const controller = createSceneConfiguration({
        readConfiguration: () => current,
        prepareImport: async selected => {
            const candidate = await session.prepareImport(selected);
            let staged;
            return { sources: candidate.prepared.sources, instanceIds: ids,
                prepareConfiguration(value) { if (stageError) throw new Error('derived geometry invalid'); staged = value; },
                commit() { candidate.commit(); current = staged; },
                dispose: candidate.dispose };
        }
    });
    return { controller, original, session, oldScene, released };
}

describe('portable configuration workflow', () => {
    it('stages absolute calibration and latest world container before touching a view', async () => {
        const saved = await config();
        const scene = { prepared: { instances: [{ id: 7 }, { id: 42 }], groups: [{ cloud: {
            count: 2, positions: [-1, -0.5, -0.25, 1, 0.5, 0.25]
        } }] } };
        const staged = prepareSourceConfiguration(scene, saved);
        expect(staged.calibration).toEqual(saved.calibration);
        staged.container.world.position.forEach((value, axis) => expect(value).toBeCloseTo(saved.container.position[axis]));
        expect(staged.container.world.dimensions).toEqual([1, 2, 3]);
        expect(staged.reference.longest).toBe(2);
        expect(staged.lengthRevision).toBe(0);
        expect(Object.isFrozen(staged.reference)).toBe(true);
        expect(() => prepareSourceConfiguration(scene, { ...saved,
            calibration: { ...saved.calibration, longestMeters: 1e100 } })).toThrow(/GPU/);
        expect(() => prepareSourceConfiguration(scene, { ...saved,
            calibration: { ...saved.calibration, longestMeters: 1e-50 } })).toThrow(/Float32/);
    });
    it('imports configuration as pending and restores renamed sources without starting simulation', async () => {
        const { controller, original, session, oldScene } = await setup();
        controller.importConfiguration(JSON.stringify(original));
        expect(controller.getState().status).toBe('awaiting-sources');
        expect(session.getState().scene).toBe(oldScene);
        const renamed = files(); renamed.geometry = new File(['abc'], 'renamed.ply');
        expect(await controller.associateSources(renamed)).toEqual({ restored: true, mismatchedSlots: [] });
        expect(controller.exportConfiguration()).toEqual(original);
        expect(controller.getState()).toMatchObject({ status: 'restored', pending: null });
        expect(session.getState().scene).not.toBe(oldScene);
        expect(JSON.parse(controller.exportJSON()).participantIds).toEqual([7, 42]);
    });

    it('imports changed bytes as a fresh scene without applying any saved edits', async () => {
        const { controller, original } = await setup();
        controller.importConfiguration(original);
        const changed = files(); changed.geometry = new File(['abd'], 'scene.ply');
        expect(await controller.associateSources(changed)).toEqual({ restored: false, mismatchedSlots: ['geometry'] });
        expect(controller.getState().status).toBe('new-scene');
    });

    it.each([{ ids: [7] }, { stageError: true }])('preserves the old scene when references or derived geometry fail: %j', async options => {
        const { controller, original, session, oldScene, released } = await setup(options);
        controller.importConfiguration(original);
        await expect(controller.associateSources(files())).rejects.toThrow();
        expect(session.getState().scene).toBe(oldScene);
        expect(controller.exportConfiguration()).toEqual(original);
        expect(controller.getState().pending).toEqual(original);
        expect(released).toHaveLength(1);
    });

    it('keeps both current edits and a pending valid config after a corrupt import', async () => {
        const { controller, original } = await setup();
        controller.importConfiguration(original);
        expect(() => controller.importConfiguration({ ...original, runtime: {} })).toThrow(/unknown field/);
        expect(controller.getState().pending).toEqual(original);
        expect(controller.exportConfiguration()).toEqual(original);
    });

    it('disposes a late candidate and never commits it after cancellation', async () => {
        let resolve;
        let committed = false, disposed = false;
        const original = await config();
        const controller = createSceneConfiguration({ readConfiguration: () => original,
            prepareImport: () => new Promise(done => { resolve = done; }) });
        controller.importConfiguration(original);
        const operation = controller.associateSources(files());
        controller.cancel();
        resolve({ sources: original.sources, instanceIds: [7, 42], prepareConfiguration() {},
            commit() { committed = true; }, dispose() { disposed = true; } });
        await expect(operation).rejects.toMatchObject({ name: 'AbortError' });
        expect(committed).toBe(false);
        expect(disposed).toBe(true);
        expect(controller.getState().status).toBe('awaiting-sources');
    });
});
