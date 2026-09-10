import { Vec3 } from 'playcanvas';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { attachGrabber } from '../../src/ui/grab.js';
import { createInteractionOwnership } from '../../src/ui/sceneSelection.js';

afterEach(() => vi.unstubAllGlobals());

describe('grab pointer ownership', () => {
    it('releases the shared ledger when a live GPU readback rejects', async () => {
        const handlers = new Map();
        vi.stubGlobal('window', {
            addEventListener: (name, handler) => handlers.set(name, handler),
            removeEventListener: (name, handler) => {
                if (handlers.get(name) === handler) handlers.delete(name);
            }
        });
        const canvas = {
            style: {},
            getBoundingClientRect: () => ({ left: 0, top: 0 })
        };
        const ownership = createInteractionOwnership();
        const failure = new Error('readback failed');
        const target = {
            tank: { position: [0, 0, 0] },
            grab: vi.fn(() => Promise.reject(failure)),
            moveGrab: vi.fn(), releaseGrab: vi.fn()
        };
        const camera = {
            forward: new Vec3(0, 0, -1),
            camera: {
                nearClip: 0, farClip: 1,
                screenToWorld(x, y, z, out) { out.set(x, y, z); }
            }
        };
        const onError = vi.fn();
        const handle = attachGrabber({ graphicsDevice: { canvas } }, camera, target,
            { ownership, onError });
        const event = {
            pointerId: 19, button: 0, target: canvas, clientX: 1, clientY: 2,
            stopPropagation: vi.fn(), preventDefault: vi.fn()
        };

        handlers.get('pointerdown')(event);
        expect(ownership.ownerOf(19)).toBe('grab');
        await Promise.resolve();
        await Promise.resolve();
        expect(ownership.ownerOf(19)).toBe(null);
        expect(target.releaseGrab).toHaveBeenCalledOnce();
        expect(onError).toHaveBeenCalledWith(failure);
        handle.detach();
    });
});
