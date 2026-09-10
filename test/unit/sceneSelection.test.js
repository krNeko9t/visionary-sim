import { describe, expect, it, vi } from 'vitest';

import {
    attachPointerOwner,
    attachSceneSelection,
    createInteractionOwnership
} from '../../src/ui/sceneSelection.js';

class PointerSurface {
    constructor() {
        this.listeners = new Map();
        this.captured = new Set();
    }

    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }

    removeEventListener(type, listener) {
        this.listeners.set(type, (this.listeners.get(type) ?? []).filter(candidate => candidate !== listener));
    }

    setPointerCapture(id) { this.captured.add(id); }
    releasePointerCapture(id) { this.captured.delete(id); }

    fire(type, options = {}) {
        const event = { button: 0, pointerId: 1, clientX: 10, clientY: 20, isPrimary: true, ...options };
        for (const listener of this.listeners.get(type) ?? []) listener(event);
        return event;
    }
}

describe('scene selection pointer ownership', () => {
    it('selects only from an unclaimed primary left click', async () => {
        const canvas = new PointerSurface();
        const pick = vi.fn(async () => 42);
        const select = vi.fn();
        const selection = attachSceneSelection({ canvas, pick, select });

        canvas.fire('pointerdown');
        canvas.fire('pointerup', { clientX: 12, clientY: 21 });
        await Promise.resolve();

        expect(pick).toHaveBeenCalledOnce();
        expect(select).toHaveBeenCalledWith(42);
        expect(canvas.captured.size).toBe(0);
        selection.detach();
    });

    it('does not turn orbit, pan, a drag, gizmo work or grabbing into selection', async () => {
        const canvas = new PointerSurface();
        const pick = vi.fn(async () => 7);
        const select = vi.fn();
        let externallyOwned = false;
        const selection = attachSceneSelection({
            canvas,
            pick,
            select,
            isInteractionOwned: () => externallyOwned
        });

        canvas.fire('pointerdown', { button: 2 });
        canvas.fire('pointerup', { button: 2 });
        canvas.fire('pointerdown', { button: 1 });
        canvas.fire('pointerup', { button: 1 });
        canvas.fire('pointerdown');
        canvas.fire('pointermove', { clientX: 30 });
        canvas.fire('pointerup', { clientX: 30 });
        externallyOwned = true;
        canvas.fire('pointerdown', { pointerId: 2 });
        canvas.fire('pointerup', { pointerId: 2 });
        await Promise.resolve();

        expect(pick).not.toHaveBeenCalled();
        expect(select).not.toHaveBeenCalled();
        selection.detach();
    });

    it('lets camera, gizmo, selection and grab share an explicit first-owner ledger', () => {
        const ownership = createInteractionOwnership();

        expect(ownership.claim(3, 'gizmo')).toBe(true);
        expect(ownership.claim(3, 'selection')).toBe(false);
        expect(ownership.ownerOf(3)).toBe('gizmo');
        expect(ownership.release(3, 'grab')).toBe(false);
        expect(ownership.release(3, 'gizmo')).toBe(true);
        expect(ownership.claim(3, 'grab')).toBe(true);
        ownership.clear('grab');
        expect(ownership.ownerOf(3)).toBe(null);
    });

    it('adapts camera, gizmo and grab handlers without moving their interaction logic', () => {
        const canvas = new PointerSurface();
        const ownership = createInteractionOwnership();
        const camera = attachPointerOwner({
            target: canvas,
            ownership,
            owner: 'camera',
            shouldClaim: event => event.button === 2
        });

        canvas.fire('pointerdown', { pointerId: 4, button: 2 });
        expect(ownership.ownerOf(4)).toBe('camera');
        canvas.fire('pointerup', { pointerId: 4, button: 2 });
        expect(ownership.ownerOf(4)).toBe(null);
        camera.detach();
    });

    it('ignores stale asynchronous pick results after detach or a newer click', async () => {
        const canvas = new PointerSurface();
        const resolutions = [];
        const pick = vi.fn(() => new Promise(resolve => resolutions.push(resolve)));
        const select = vi.fn();
        const selection = attachSceneSelection({ canvas, pick, select });

        canvas.fire('pointerdown');
        canvas.fire('pointerup');
        canvas.fire('pointerdown', { pointerId: 2 });
        canvas.fire('pointerup', { pointerId: 2 });
        resolutions[0](7);
        resolutions[1](42);
        await Promise.resolve();
        await Promise.resolve();
        expect(select).toHaveBeenCalledTimes(1);
        expect(select).toHaveBeenCalledWith(42);

        canvas.fire('pointerdown', { pointerId: 3 });
        canvas.fire('pointerup', { pointerId: 3 });
        selection.detach();
        resolutions[2](7);
        await Promise.resolve();
        expect(select).toHaveBeenCalledTimes(1);
    });
});
