import { describe, expect, it, vi } from 'vitest';
import { Entity, Vec3 } from 'playcanvas';
import { SceneApplication } from '../../src/app/scene.js';

async function fixture() {
    const root = new Entity();
    const positions = new Float32Array([10, 20, 30, 12, 21, 30.5]);
    const cloud = { count: 2, positions, sphericalHarmonics: [new Float32Array([1, 2])] };
    const prepared = { count: 2, untrackedCount: 2, instances: [], groups: [{ id: 0, cloud }] };
    const application = new SceneApplication({ canvas: {}, host: {}, browser: { addEventListener() {}, removeEventListener() {} }, deps: {
        createEngine: async () => ({ graphicsDevice: {}, start() {}, destroy() {} }),
        createStage: () => ({ camera: {}, controls: {} }), createGroundGrid: () => ({ dispose() {} }),
        detectCapabilities: () => ({ available: true }),
        createImportTask: () => ({ promise: Promise.resolve(prepared), cancel() {} }),
        createViews: () => ({ views: { root, groups: [] }, attach() {}, dispose() {} }),
        mountImport: () => ({ dispose() {} }), mountInspector: () => ({ element: {}, dispose() {} }),
        mountCalibration: () => ({ dispose() {} }),
        attachNavigation: () => ({ selection: { invalidate: vi.fn() }, dispose() {} }), applyColors() {}
    } });
    await application.start(); await application.importScene({});
    return { application, root, cloud };
}

describe('public preparation operations', () => {
    it('calibrates source-preserving scene TRS, follows the container and restores without drift', async () => {
        const { application: a, root, cloud } = await fixture();
        const reference = a.state().preparation.reference;
        expect(a.state().preparation.container.world.dimensions).toEqual([1, .5, .25]);
        const original = cloud.positions.slice();
        a.setCalibration({ upAxis: '+Z', manualDegrees: [20, 30, 40], longestMeters: 2, position: [1, 2, 3] });
        const p = a.state().preparation;
        const actual = root.getWorldTransform().transformPoint(new Vec3(...original.slice(0, 3)));
        p.transform.toWorldPoint(original.slice(0, 3)).forEach((v, i) => expect([actual.x, actual.y, actual.z][i]).toBeCloseTo(v, 5));
        const saved = a.getSourceConfiguration();
        a.setCalibration({ upAxis: '-X' });
        expect(a.state().preparation.calibration.manualDegrees).toEqual([20, 30, 40]);
        a.restoreSourceConfiguration(saved);
        expect(a.getSourceConfiguration().calibration).toEqual(saved.calibration);
        a.getSourceConfiguration().container.position.forEach((v, i) => expect(v).toBeCloseTo(saved.container.position[i], 12));
        expect(a.state().preparation.reference).toBe(reference);
        expect(cloud.positions).toEqual(original);
        expect([...cloud.sphericalHarmonics[0]]).toEqual([1, 2]);
        a.destroy();
    });

    it('edits the box without changing the source or root, reports outside centres and gates runtime edits', async () => {
        const { application: a, root } = await fixture();
        const matrix = [...root.getWorldTransform().data];
        a.editContainer({ position: [4, 5, 6], dimensions: [.1, .2, .3], rotationDegrees: [0, 0, 90] });
        expect([...root.getWorldTransform().data]).toEqual(matrix);
        expect(a.state().preparation.containment.outsideCount).toBe(2);
        const saved = a.getSourceConfiguration();
        expect(() => a.editContainer({ dimensions: [0, 1, 1] })).toThrow();
        expect(() => a.setCalibration({ longestMeters: 1e40 })).toThrow('GPU');
        expect(() => a.setCalibration({ longestMeters: 1e-50 })).toThrow('Float32');
        expect(() => a.editContainer({ dimensions: [1e-50, 1, 1] })).toThrow('Float32');
        expect(() => a.restoreSourceConfiguration({ ...saved, container: { ...saved.container, dimensions: [0, 1, 1] } })).toThrow();
        expect(a.getSourceConfiguration()).toEqual(saved);
        expect([...root.getWorldTransform().data]).toEqual(matrix);
        for (const phase of ['preparing', 'running', 'paused']) {
            a.setPreparationPhase(phase);
            expect(a.state().preparationEditable).toBe(false);
            expect(() => a.setCalibration({ longestMeters: 2 })).toThrow();
            expect(() => a.editContainer({ position: [0, 0, 0] })).toThrow();
        }
        a.setPreparationPhase('prepare');
        a.setCalibration({ longestMeters: 2 });
        expect(a.state().preparation.lengthRevision).toBe(1);
        expect(a.state().preparation.container.world.dimensions[0]).toBeCloseTo(.2);
        a.destroy();
    });
});
