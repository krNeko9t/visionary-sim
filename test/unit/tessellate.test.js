import { describe, expect, it } from 'vitest';

import { joinPatches, patch } from '../../src/assets/tessellate.js';

/**
 * @param {(u: number, v: number) => number[]} point - Surface point.
 * @param {object} [options] - Topology, as {@link patch} takes it.
 * @returns {import('../../src/assets/objLoader.js').TriangleMesh} A 4 x 3 patch.
 */
function small(point, options) {
    return patch(4, 3, point, options);
}

describe('patch', () => {
    it('emits a grid of vertices when nothing is wrapped', () => {
        const { positions, indices } = small((u, v) => [u, v, 0]);
        expect(positions.length / 3).toBe(5 * 4);
        expect(indices.length).toBe(4 * 3 * 6);
        expect(Math.max(...indices)).toBe(5 * 4 - 1);
    });

    it('drops the seam row of a wrapped axis instead of duplicating it', () => {
        const { positions, indices } = small((u, v) => [Math.cos(u * 2 * Math.PI), v, 0], { wrapU: true });
        expect(positions.length / 3).toBe(4 * 4);
        // Still the same quads: the last column indexes back to the first.
        expect(indices.length).toBe(4 * 3 * 6);
        expect(Math.max(...indices)).toBe(4 * 4 - 1);
    });

    it('closes a row that is a single point into a single vertex', () => {
        // The sphere's poles. Without this, each copy of the pole is shaded by
        // one column's triangles alone and the pole comes out as a dark speck.
        const { positions, indices } = small((u, v) => (v === 0 ? [0, 1, 0] : [u, v, 0]));
        expect(positions.length / 3).toBe(1 + 5 * 3);
        expect([...indices].filter(index => index === 0).length).toBeGreaterThan(1);
        expect(Math.max(...indices)).toBe(5 * 3);
    });
});

describe('joinPatches', () => {
    it('offsets each patch onto its own vertices', () => {
        const one = small((u, v) => [u, v, 0]);
        const two = small((u, v) => [u, v, 1]);
        const joined = joinPatches([one, two]);

        expect(joined.positions.length).toBe(one.positions.length * 2);
        expect(joined.indices.length).toBe(one.indices.length * 2);
        // Nothing in the second patch may point at a vertex of the first.
        const half = one.indices.length;
        expect(Math.min(...joined.indices.slice(half))).toBe(one.positions.length / 3);
    });
});
