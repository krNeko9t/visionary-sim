import { describe, expect, it, vi } from 'vitest';

import { attachInstanceMaterials, createInstanceMaterials } from '../../src/app/instanceMaterials.js';

const catalog = [
    { id: 0, name: '未追踪内容', count: 19 },
    {
        id: 7,
        name: '叶片',
        count: 12,
        physics: {
            rho_si: 780,
            E_si: 4.2e6,
            nu_si: 0.31,
            trust: 'medium',
            uncertainty: { kind: 'upstream-score', value: 0.2 },
            mu_z: -0.4,
            var: 0.18,
            mu_spread: 0.05,
            mu_mean_per_gaussian_z: -0.37
        }
    },
    { id: 42, name: '遮挡物', count: 8, physics: { rho_si: 1200 } }
];

describe('instance material application state', () => {
    it('keeps stable positive source IDs and leaves label zero render-only', () => {
        const materials = createInstanceMaterials(catalog);
        const state = materials.getState();

        expect(state.instances.map(instance => instance.id)).toEqual([7, 42]);
        expect(state.untracked).toEqual({ id: 0, name: '未追踪内容', count: 19 });
        expect(() => materials.selectInstance(0)).toThrow(/positive instance ID/);
        materials.selectInstance(42);
        expect(materials.getState().selectedId).toBe(42);
    });

    it('shows source values separately and completes only the selected instance', () => {
        const materials = createInstanceMaterials(catalog);
        materials.selectInstance(42);
        materials.setMaterialOverride(42, { E_si: 9e5, nu_si: 0.4 });

        const [complete, edited] = materials.getState().instances;
        expect(complete.sourceMaterial).toEqual({ density: 780, youngsModulus: 4.2e6, poissonRatio: 0.31 });
        expect(complete.overrides).toEqual({});
        expect(complete.eligible).toBe(true);
        expect(edited.sourceMaterial).toEqual({ density: 1200 });
        expect(edited.overrides).toEqual({ youngsModulus: 9e5, poissonRatio: 0.4 });
        expect(edited.effectiveMaterial).toEqual({ density: 1200, youngsModulus: 9e5, poissonRatio: 0.4 });
        expect(edited.missingFields).toEqual([]);
        expect(edited.eligible).toBe(true);
        expect(materials.getState().instances[0]).toEqual(complete);
    });

    it('retains illegal overrides without clamping or silently restoring the source', () => {
        const materials = createInstanceMaterials(catalog);
        materials.setMaterialOverride(7, { density: 0, youngsModulus: 1e30, poissonRatio: 0.2 });
        const instance = materials.getState().instances[0];

        expect(instance.effectiveMaterial).toEqual({ density: 0, youngsModulus: 1e30, poissonRatio: 0.2 });
        expect(instance.errors).toEqual({
            density: '密度必须是有限正数。',
            poissonRatio: '泊松比必须在 0.25 到 0.49 之间。'
        });
        expect(instance.eligible).toBe(false);

        materials.clearMaterialOverride(7, ['density', 'poissonRatio']);
        expect(materials.getState().instances[0].effectiveMaterial).toEqual({
            density: 780,
            youngsModulus: 1e30,
            poissonRatio: 0.31
        });
    });

    it('preserves upstream confidence metadata without interpreting it as SI accuracy', () => {
        const materials = createInstanceMaterials(catalog);
        const instance = materials.getState().instances[0];

        expect(instance.upstreamAssessment).toEqual({
            trust: 'medium',
            uncertainty: { kind: 'upstream-score', value: 0.2 },
            mu_z: -0.4,
            var: 0.18,
            mu_spread: 0.05,
            mu_mean_per_gaussian_z: -0.37
        });
        expect(instance.assessmentNotice).toMatch(/not SI error bars/i);
        expect(instance.assessmentNotice).toMatch(/not proof of accuracy/i);
        expect(instance.assessmentNotice).toMatch(/original inference space/i);
    });

    it('publishes selection, coloring and edits through observable public operations', () => {
        const materials = createInstanceMaterials(catalog);
        const listener = vi.fn();
        const unsubscribe = materials.subscribe(listener);

        materials.selectInstance(7);
        materials.setColorMode('instances');
        materials.setMaterialOverride(7, { density: 900 });
        unsubscribe();
        materials.selectInstance(null);

        expect(listener).toHaveBeenCalledTimes(4);
        expect(listener.mock.calls[2][0].colorMode).toBe('instances');
        expect(listener.mock.calls[3][0].instances[0].overrides.density).toBe(900);
    });

    it('rejects duplicate, non-integer and non-positive editable identities', () => {
        expect(() => createInstanceMaterials([{ id: 2 }, { id: 2 }])).toThrow(/duplicate/);
        expect(() => createInstanceMaterials([{ id: -1 }])).toThrow(/positive integer/);
        expect(() => createInstanceMaterials([{ id: 1.5 }])).toThrow(/positive integer/);
    });

    it('adapts a published scene session and keeps inspection through failed replacement state', () => {
        let state = { scene: null, import: { status: 'idle' } };
        const listeners = new Set();
        const session = {
            getState: () => state,
            subscribe(listener) {
                listeners.add(listener);
                listener(state);
                return () => listeners.delete(listener);
            }
        };
        const inspection = attachInstanceMaterials(session);
        const publish = next => {
            state = next;
            for (const listener of listeners) listener(state);
        };
        const scene = {
            prepared: {
                untrackedCount: 5,
                instances: [{
                    id: 9,
                    name: '猫',
                    material: { valid: false, source: { rho_si: 800, E_si: 1e5 }, issues: ['缺少 nu_si'] }
                }]
            }
        };

        publish({ scene, import: { status: 'ready' } });
        inspection.selectInstance(9);
        inspection.setMaterialOverride(9, { nu_si: 0.3 });
        publish({ scene, import: { status: 'failed', error: 'new scene failed' } });

        expect(inspection.getState().inspection.selectedId).toBe(9);
        expect(inspection.getState().inspection.selected.eligible).toBe(true);
        expect(inspection.getState().inspection.untracked.count).toBe(5);
        inspection.dispose();
    });

    it('treats a null prepared material source as a missing record', () => {
        const materials = createInstanceMaterials([{
            id: 3,
            material: { valid: false, source: null, issues: ['缺少物性记录'] }
        }]);

        expect(materials.getState().instances[0]).toMatchObject({
            sourceMaterial: {},
            missingFields: ['density', 'youngsModulus', 'poissonRatio'],
            eligible: false
        });
    });
});
