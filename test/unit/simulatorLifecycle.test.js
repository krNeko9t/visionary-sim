import { describe, expect, it, vi } from 'vitest';

import { Simulator } from '../../src/sim/simulator.js';

describe('simulator asynchronous lifecycle', () => {
    it('does not install a hold after release invalidates an in-flight readback', async () => {
        let resolvePositions;
        const positions = new Promise(resolve => { resolvePositions = resolve; });
        const sim = Object.create(Simulator.prototype);
        Object.assign(sim, {
            alive: true,
            grabEpoch: 0,
            particles: {
                readPositions: vi.fn(() => positions),
                invMass: new Float32Array([1]),
                offsets: new Uint32Array([0, 1])
            },
            drive: { release: vi.fn(), hold: vi.fn(), capacity: 4096 },
            grip: { strategy: 'singleNode', radius: 0.03 },
            handle: { target: [0, 0, 0], previousTarget: [0, 0, 0] },
            coarsestCell: () => 1
        });

        const pending = sim.grab([0, 0, -1], [0, 0, 1]);
        sim.releaseGrab();
        resolvePositions(new Float32Array([0, 0, 0, 1]));

        await expect(pending).resolves.toBeNull();
        expect(sim.drive.release).toHaveBeenCalledOnce();
        expect(sim.drive.hold).not.toHaveBeenCalled();
    });

    it('makes release safe after destruction starts', () => {
        const destroy = vi.fn();
        const sim = Object.create(Simulator.prototype);
        Object.assign(sim, {
            alive: true,
            grabEpoch: 0,
            drive: { release: vi.fn(), destroy },
            stepper: { destroy }, contact: { destroy }, elastic: { destroy },
            particles: { destroy }
        });

        sim.destroy();
        sim.releaseGrab();
        sim.destroy();
        expect(sim.drive.release).toHaveBeenCalledOnce();
        expect(destroy).toHaveBeenCalledTimes(5);
    });

    it('swallows a readback rejection after the attempt was invalidated', async () => {
        let rejectPositions;
        const positions = new Promise((_, reject) => { rejectPositions = reject; });
        const sim = Object.create(Simulator.prototype);
        Object.assign(sim, {
            alive: true,
            grabEpoch: 0,
            particles: { readPositions: () => positions },
            drive: { release: vi.fn() }
        });

        const pending = sim.grab([], []);
        sim.releaseGrab();
        rejectPositions(new Error('buffer destroyed'));
        await expect(pending).resolves.toBeNull();
    });
});
