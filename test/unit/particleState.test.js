import { describe, expect, it, vi } from 'vitest';

import { Particles } from '../../src/sim/state/particles.js';

/**
 * The one thing `sim/state` had to learn for a body to be appended: how to open
 * on somebody else's state instead of on the rest state.
 *
 * Called against a stand-in rather than a real allocation, because the claim
 * being tested is not about buffers -- it is that the snapshot is a *prefix*,
 * so nodes already being simulated keep their index, and that all three
 * buffers travel together. A snapshot of positions alone would restore a scene
 * that is in the right place and standing still.
 */

/**
 * @param {number} nodeCount - Nodes this stand-in claims to hold.
 * @returns {object} Something `snapshot` and `adopt` can be called on.
 */
function buffers(nodeCount) {
    const buffer = mark => ({
        writes: [],
        write(offset, data) { this.writes.push({ offset, data }); },
        read(offset, byteLength, target) { target.fill(mark); return Promise.resolve(); }
    });
    return {
        nodeCount,
        nodePos: buffer(11),
        nodePrev: buffer(22),
        nodeVel: buffer(33)
    };
}

describe('node state crossing from one allocation to the next', () => {
    it('takes position, previous position and velocity together', async () => {
        const state = await Particles.prototype.snapshot.call(buffers(3));

        expect(state.nodeCount).toBe(3);
        for (const part of ['positions', 'previous', 'velocities']) {
            expect(state[part]).toHaveLength(12);
        }
        // Distinct sources, so a snapshot that read one buffer three times fails.
        expect(new Set([state.positions[0], state.previous[0], state.velocities[0]]).size).toBe(3);
    });

    it('adopts a smaller set as a prefix, leaving the rest at rest', () => {
        const target = buffers(7);
        const state = {
            nodeCount: 4,
            positions: new Float32Array(16).fill(1),
            previous: new Float32Array(16).fill(2),
            velocities: new Float32Array(16).fill(3)
        };

        Particles.prototype.adopt.call(target, state);

        for (const [buffer, values] of [
            [target.nodePos, state.positions],
            [target.nodePrev, state.previous],
            [target.nodeVel, state.velocities]
        ]) {
            expect(buffer.writes).toEqual([{ offset: 0, data: values }]);
        }
    });

    it('refuses a snapshot that would not fit rather than dropping a body', () => {
        const target = buffers(2);
        const state = {
            nodeCount: 5,
            positions: new Float32Array(20),
            previous: new Float32Array(20),
            velocities: new Float32Array(20)
        };

        expect(() => Particles.prototype.adopt.call(target, state))
            .toThrow(/cannot adopt 5 nodes into 2/);
        expect(target.nodePos.writes).toEqual([]);
    });

    it('is the same shape a real Particles hands out', () => {
        // Guards the stand-in above: if these method names or the snapshot's
        // fields drift, the tests keep passing against a fiction.
        expect(typeof Particles.prototype.snapshot).toBe('function');
        expect(typeof Particles.prototype.adopt).toBe('function');
        expect(vi.isMockFunction(Particles.prototype.adopt)).toBe(false);
    });
});
