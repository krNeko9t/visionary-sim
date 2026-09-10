import { describe, expect, it, vi } from 'vitest';
const picking = vi.hoisted(() => ({ result: vi.fn() }));
vi.mock('playcanvas', async original => ({
    ...await original(),
    Picker: class { resize() {} prepare() {} destroy() {} getSelectionAsync() { return picking.result(); } }
}));
import { Vec3 } from 'playcanvas';
import { attachSceneNavigation } from '../../src/ui/sceneNavigation.js';
import { createInteractionOwnership } from '../../src/ui/sceneSelection.js';

function setup() {
    const handlers = new Map();
    const canvas = {
        width: 100, height: 100,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
        setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => false,
        addEventListener(name, fn) { handlers.set(name, [...handlers.get(name) ?? [], fn]); },
        removeEventListener(name, fn) { handlers.set(name, handlers.get(name).filter(f => f !== fn)); }
    };
    let position = new Vec3(0, 0, 5);
    const camera = { camera: {}, getPosition: () => position, setPosition: p => { position = p; } };
    const ownership = createInteractionOwnership();
    const component = {};
    const scene = { views: { groups: [{ id: 1, entity: { gsplat: component } }] } };
    const select = vi.fn();
    const navigation = attachSceneNavigation({ app: { scene: { gsplat: {}, layers: { getLayerByName: () => ({}) } } },
        camera, canvas, ownership, getScene: () => scene, select, onError: vi.fn() });
    return { navigation, camera, ownership, component, select,
        fire(name, options = {}) { for (const fn of handlers.get(name) ?? []) fn({ pointerId: 1, button: 0,
            clientX: 10, clientY: 10, isPrimary: true, preventDefault() {}, ...options }); } };
}

describe('camera navigation and shared interaction ownership', () => {
    it.each(['container-gizmo', 'grab'])('blocks wheel while %s owns another pointer', owner => {
        const s = setup();
        s.ownership.claim(2, owner);
        s.fire('wheel', { deltaY: 100 });
        expect(s.camera.getPosition().z).toBe(5);
        s.ownership.release(2, owner);
        s.fire('wheel', { deltaY: 100 });
        expect(s.camera.getPosition().z).toBeGreaterThan(5);
        s.navigation.dispose();
    });
    it('invalidates picks from the old camera view before zooming', async () => {
        const s = setup();
        let resolve;
        picking.result.mockReturnValue(new Promise(r => { resolve = r; }));
        s.fire('pointerdown'); s.fire('pointerup');
        s.fire('wheel', { deltaY: 100 });
        resolve([s.component]);
        await Promise.resolve(); await Promise.resolve();
        expect(s.select).not.toHaveBeenCalled();
        s.navigation.dispose();
    });
});
