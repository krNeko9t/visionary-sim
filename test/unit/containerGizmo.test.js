import { describe, expect, it, vi } from 'vitest';
import { attachContainerGizmoPointer } from '../../src/ui/sceneCalibration.js';
import { createInteractionOwnership } from '../../src/ui/sceneSelection.js';

function fixture() {
    const listeners = {};
    const canvas = {
        addEventListener: (name, fn, capture) => { expect(capture).toBe(true); listeners[name] = fn; },
        removeEventListener() {}, getBoundingClientRect: () => ({ left: 10, top: 20 }),
        setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => true
    };
    const ownership = createInteractionOwnership();
    const gizmo = { enabled: true, _getSelection: vi.fn(() => [{}]), fire: vi.fn() };
    const bridge = attachContainerGizmoPointer({ canvas, ownership, getGizmo: () => gizmo, invalidate: vi.fn() });
    const event = { pointerId: 7, button: 0, clientX: 30, clientY: 40, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
    return { listeners, ownership, gizmo, bridge, event };
}
describe('real gizmo pointer bridge', () => {
    it('claims a hit before engine transform and stops selection propagation until release', () => {
        const f = fixture();
        f.gizmo.fire.mockImplementation(name => {
            if (name === 'pointer:down') expect(f.ownership.ownerOf(7)).toBe('container-gizmo');
        });
        f.listeners.pointerdown(f.event);
        expect(f.event.stopImmediatePropagation).toHaveBeenCalled();
        expect(f.ownership.claim(7, 'selection')).toBe(false);
        f.listeners.pointermove(f.event);
        expect(f.gizmo.fire).toHaveBeenCalledWith('pointer:move', 20, 20, expect.any(Object));
        f.listeners.pointercancel(f.event);
        expect(f.ownership.ownerOf(7)).toBe(null);
        expect(f.gizmo.fire).toHaveBeenCalledWith('pointer:up');
        f.bridge.dispose();
    });
    it('leaves misses and other owners alone and refuses movement after ownership loss', () => {
        const f = fixture();
        f.gizmo._getSelection.mockReturnValueOnce([]);
        f.listeners.pointerdown(f.event);
        expect(f.ownership.ownerOf(7)).toBe(null);
        f.ownership.claim(7, 'camera');
        f.listeners.pointerdown(f.event);
        expect(f.gizmo.fire).not.toHaveBeenCalled();
        f.ownership.clear(); f.listeners.pointerdown(f.event);
        f.gizmo.fire.mockClear(); f.ownership.clear(); f.ownership.claim(7, 'grab');
        f.listeners.pointermove(f.event);
        expect(f.gizmo.fire).not.toHaveBeenCalled();
        f.bridge.dispose();
    });
});
