import { describe, expect, it, vi } from 'vitest';

import { SceneApplication } from '../../src/app/scene.js';

function sceneData() {
    const cloud = {
        count: 2,
        dimensionality: 2,
        positions: new Float32Array([0, 0, 0, 2, 1, 0.5]),
        rotations: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1]),
        scales: new Float32Array([0.2, 0.1, 0, 0.2, 0.1, 0])
    };
    return {
        count: 2,
        untrackedCount: 0,
        groups: [{ id: 7, name: 'A', cloud }],
        instances: [{
            id: 7,
            name: 'A',
            count: 2,
            material: { source: { rho_si: 800, E_si: 1e5, nu_si: 0.3 } }
        }]
    };
}

function runtime(clock = 0) {
    return {
        freeze: vi.fn(async () => {}),
        resume: vi.fn(async () => {}),
        returnToPreparation: vi.fn(async () => {}),
        dispose: vi.fn(async () => {}),
        setMaterial: vi.fn(() => true),
        getClock: vi.fn(() => clock)
    };
}

async function fixture() {
    const prepared = sceneData();
    const root = {
        setLocalPosition() {},
        setLocalRotation() {},
        setLocalScale() {}
    };
    const sourceEntity = { enabled: true };
    const candidateInputs = [];
    const runtimes = [runtime(3.5), runtime(0)];
    let runtimeIndex = 0;
    const application = new SceneApplication({
        canvas: {},
        host: {},
        browser: { addEventListener() {}, removeEventListener() {} },
        deps: {
            createEngine: async () => ({ graphicsDevice: {}, start() {}, destroy() {} }),
            createStage: () => ({ camera: {}, controls: {} }),
            createGroundGrid: () => ({ dispose() {} }),
            detectCapabilities: () => ({ available: true }),
            createImportTask: () => ({ promise: Promise.resolve(prepared), cancel() {} }),
            createViews: () => ({
                views: { root, groups: [{ id: 7, entity: sourceEntity }] },
                attach() {},
                dispose() {}
            }),
            createSimulationCandidate: async input => {
                candidateInputs.push(input);
                const nextRuntime = runtimes[runtimeIndex++];
                return { publish: async () => nextRuntime, discard() {} };
            },
            mountImport: () => ({ dispose() {} }),
            mountInspector: () => ({ element: {}, dispose() {} }),
            mountCalibration: () => ({ dispose() {} }),
            mountSimulationControls: () => ({ dispose() {} }),
            attachNavigation: () => ({ selection: { invalidate() {} }, dispose() {} }),
            applyColors() {}
        }
    });
    await application.start();
    await application.importScene({});
    application.selectInstance(7);
    return { application, candidateInputs, runtimes, prepared };
}

describe('scene return-to-preparation workflow', () => {
    it('restores source state, retains authored preparation and restarts the whole list at the new scale', async () => {
        const { application, candidateInputs, runtimes, prepared } = await fixture();
        application.setMaterialOverride(7, { density: 950 });
        application.editContainer({ position: [1, 2, 3], dimensions: [3, 4, 5] });
        await application.addSelectedToSimulation();
        expect(application.state().simulation).toMatchObject({
            phase: 'running', participantIds: [7], clock: 3.5, grabbing: true
        });

        await application.returnToPreparation();
        expect(runtimes[0].returnToPreparation).toHaveBeenCalledOnce();
        expect(application.state()).toMatchObject({
            preparationPhase: 'prepare',
            preparationEditable: true,
            simulation: { phase: 'preparation', participantIds: [7], clock: 0, grabbing: false },
            inspection: { selected: { id: 7, overrides: { density: 950 } } }
        });
        expect(application.state().scene.prepared).toBe(prepared);
        expect(application.state().preparation.container.world).toMatchObject({
            position: [1, 2, 3], dimensions: [3, 4, 5]
        });

        application.setCalibration({ longestMeters: 2 });
        await application.startSimulation();

        expect(application.state().simulation).toMatchObject({ phase: 'running', participantIds: [7] });
        expect(candidateInputs).toHaveLength(2);
        expect(candidateInputs[1]).toMatchObject({
            participantIds: [7],
            transform: { scale: 1 },
            materials: { 7: { density: 950, youngsModulus: 1e5, poissonRatio: 0.3 } }
        });
        application.destroy();
    });
});
