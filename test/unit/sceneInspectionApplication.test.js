import { describe, it, expect, vi } from 'vitest';
import { SceneApplication } from '../../src/app/scene.js';

function fixture() {
    let prepared;
    let navigationOptions;
    let inspectorActions;
    const colors = vi.fn();
    const controls = { enabled: true };
    const camera = {};
    const application = new SceneApplication({
        canvas: {}, host: {}, browser: { addEventListener() {}, removeEventListener() {} },
        deps: {
            createEngine: async () => ({ graphicsDevice: {}, start() {}, destroy() {} }),
            createStage: () => ({ camera, controls }),
            createGroundGrid: () => ({ dispose() {} }),
            detectCapabilities: () => ({ available: true }),
            createImportTask: () => ({ promise: Promise.resolve(prepared), cancel() {} }),
            createViews: () => ({ views: { groups: [] }, attach() {}, dispose() {} }),
            mountImport: () => ({ element: {}, dispose() {} }),
            mountInspector: ({ materials }) => {
                inspectorActions = materials;
                return { element: {}, dispose() {} };
            },
            attachNavigation: options => {
                navigationOptions = options;
                return { selection: { invalidate: vi.fn() }, dispose() {} };
            },
            applyColors: colors,
            mountCalibration: () => ({ dispose() {} })
        }
    });
    return { application, colors, camera, controls,
        setPrepared: next => { prepared = next; },
        navigation: () => navigationOptions,
        inspector: () => inspectorActions };
}

describe('production scene inspection operations', () => {
    it('shares list and scene selections and publishes unmodified SI values and coloring', async () => {
        const f = fixture();
        await f.application.start();
        f.setPrepared({ count: 2, untrackedCount: 1, instances: [{ id: 17, name: 'hidden', material: {
            source: { E_si: 4e9, nu_si: .3 }, valid: false, issues: ['rho']
        } }] });
        await f.application.importScene({});
        f.inspector().selectInstance(17);
        f.application.setMaterialOverride(17, { rho_si: 900 });
        f.application.setColorMode('instances');
        expect(f.application.state().inspection.selected).toMatchObject({
            id: 17, eligible: true, sourceMaterial: { youngsModulus: 4e9, poissonRatio: .3 },
            effectiveMaterial: { youngsModulus: 4e9, poissonRatio: .3, density: 900 }
        });
        expect(f.colors.mock.lastCall[1]).toMatchObject({ selectedId: 17, colorMode: 'instances' });
        f.navigation().select(null);
        expect(f.application.state().inspection.selectedId).toBe(null);
        expect(f.application.camera).toBe(f.camera);
        expect(f.navigation().ownership).toBe(f.application.pointerOwnership);
        expect(f.controls.enabled).toBe(false);
        f.application.destroy();
        expect(f.application.state().inspection).toBe(null);
    });

    it('removes an observer whose initial call throws', () => {
        const { application } = fixture();
        const listener = () => { throw new Error('observer'); };
        expect(() => application.subscribe(listener)).toThrow('observer');
        expect(application.listeners.has(listener)).toBe(false);
    });
});
