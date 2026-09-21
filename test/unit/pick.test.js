import { describe, expect, it } from 'vitest';

import { bodyOfNode, nearestNodeToRay } from '../../src/sim/pick.js';

/**
 * @param {number[][]} points - Node positions.
 * @returns {Float32Array} Them, in the arena's vec4-per-node layout.
 */
function nodes(points) {
    const packed = new Float32Array(points.length * 4);
    points.forEach(([x, y, z], n) => packed.set([x, y, z, 0], n * 4));
    return packed;
}

/** Ray down +z from the origin. */
const FORWARD = { origin: [0, 0, 0], direction: [0, 0, 1] };

describe('nearestNodeToRay', () => {
    /**
     * @param {number[][]} points - Node positions.
     * @param {number[]} [masses] - Inverse masses, defaulting to all movable.
     * @param {number} [radius] - Pick tolerance.
     * @returns {number} The chosen node.
     */
    const pick = (points, masses = points.map(() => 1), radius = 0.1) =>
        nearestNodeToRay(nodes(points), Float32Array.from(masses), FORWARD.origin, FORWARD.direction, radius);

    it('finds the node the ray passes closest to', () => {
        expect(pick([[1, 0, 1], [0.02, 0, 1], [0, 0.5, 1]])).toBe(1);
    });

    it('takes the nearer of two the ray passes through', () => {
        // What makes clicking an object in front of another grab the one in
        // front, rather than whichever the line happens to graze more exactly.
        expect(pick([[0, 0, 5], [0.05, 0, 1]])).toBe(1);
    });

    it('will not grab a node with no material', () => {
        // Those never move, so a grab that landed on one would look like the
        // drag silently failing.
        expect(pick([[0, 0, 1]], [0])).toBe(-1);
        expect(pick([[0, 0, 1], [0, 0, 2]], [0, 1])).toBe(1);
    });

    it('ignores what is behind the pointer', () => {
        expect(pick([[0, 0, -1]])).toBe(-1);
    });

    it('looks past static material at the original tolerance, or misses an all-static ray', () => {
        const positions = nodes([[0, 0, 1], [0.05, 0, 2], [0.2, 0, 1.5]]);
        const masses = Float32Array.from([2, 3, 4]);
        expect(nearestNodeToRay(positions, masses, FORWARD.origin, FORWARD.direction, 0.1, new Set([0]))).toBe(1);
        expect(nearestNodeToRay(positions, masses, FORWARD.origin, FORWARD.direction, 0.1, new Set([0, 1]))).toBe(-1);
        expect(Array.from(masses)).toEqual([2, 3, 4]);
    });

    it('reports a miss rather than the least bad answer', () => {
        expect(pick([[0.4, 0, 1], [0, 0.4, 2]])).toBe(-1);
    });
});

describe('bodyOfNode', () => {
    it('maps a node back to the body whose range contains it', () => {
        const offsets = [0, 10, 25];
        expect([0, 9, 10, 24, 25, 99].map(node => bodyOfNode(offsets, node))).toEqual([0, 0, 1, 1, 2, 2]);
    });

    it('answers 0 for a single body', () => {
        expect(bodyOfNode([0], 7)).toBe(0);
    });
});
