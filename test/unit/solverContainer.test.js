import { describe, expect, it } from 'vitest';

import {
    limitPointToContainer,
    resolveContainerContact,
    solverContainerFrame,
    toContainerPoint,
    toWorldPoint
} from '../../src/sim/solver/container.js';
import { limitGripTarget } from '../../src/sim/grip.js';
import finalizeWgsl from '../../src/sim/solver/wgsl/finalize.wgsl?raw';

const close = (actual, expected, digits = 10) => {
    expect(actual).toHaveLength(expected.length);
    actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], digits));
};

const quarterTurnZ = [0, 0, Math.SQRT1_2, Math.SQRT1_2];

describe('the static six-sided solver container', () => {
    const frame = solverContainerFrame({
        position: [2, 3, 4],
        orientation: quarterTurnZ,
        dimensions: [2, 4, 6]
    });

    it('round-trips points through its local rigid frame', () => {
        const world = [0.5, 3.25, 7];
        close(toWorldPoint(frame, toContainerPoint(frame, world)), world);
        close(frame.halfSize, [1, 2, 3]);
    });

    it('resolves all six inward faces after rotation, including the top', () => {
        const probes = [
            [[1.25, 0, 0], [1, 0, 0]], [[-1.25, 0, 0], [-1, 0, 0]],
            [[0, 2.25, 0], [0, 2, 0]], [[0, -2.25, 0], [0, -2, 0]],
            [[0, 0, 3.25], [0, 0, 3]], [[0, 0, -3.25], [0, 0, -3]]
        ];
        for (const [outside, boundary] of probes) {
            const current = toWorldPoint(frame, outside);
            const previous = toWorldPoint(frame, outside);
            const resolved = resolveContainerContact(frame, current, previous, 0);
            close(toContainerPoint(frame, resolved), boundary);
        }
    });

    it('computes friction in the local contact plane without changing world distance', () => {
        const previous = toWorldPoint(frame, [0, 1.8, 0]);
        const current = toWorldPoint(frame, [0.3, 2.2, 0]);
        const resolved = toContainerPoint(frame, resolveContainerContact(frame, current, previous, 0.5));

        close(resolved, [0.2, 2, 0]);
    });

    it('matches kernel order when friction couples several violated faces', () => {
        const previous = toWorldPoint(frame, [-0.6, -1.5, -2.4]);
        const current = toWorldPoint(frame, [-1.4, -2.5, -3.6]);
        const resolved = toContainerPoint(frame,
            resolveContainerContact(frame, current, previous, 0.35));

        // Kernel order is y-, x-, x+, z-, z+, y+. Each correction changes the
        // tangent available to the next face, so this pins the complete order,
        // unlike six independent zero-friction face probes.
        close(resolved, [-0.917089076257372, -1.860349053161687, -3], 8);

        const calls = [...finalizeWgsl.matchAll(/p = resolvePlane\(p, prev, ([^;]+);/g)]
            .map(match => match[1]);
        expect(calls).toEqual([
            'vec3f(0.0, 1.0, 0.0), lo.y - p.y, fr)',
            'vec3f(1.0, 0.0, 0.0), lo.x - p.x, fr)',
            'vec3f(-1.0, 0.0, 0.0), p.x - hi.x, fr)',
            'vec3f(0.0, 0.0, 1.0), lo.z - p.z, fr)',
            'vec3f(0.0, 0.0, -1.0), p.z - hi.z, fr)',
            'vec3f(0.0, -1.0, 0.0), p.y - hi.y, fr)'
        ]);
    });

    it('clamps a point in local coordinates and exposes the same rule to grip', () => {
        const target = toWorldPoint(frame, [4, -3, 0.5]);
        const expected = toWorldPoint(frame, [1, -2, 0.5]);
        close(limitPointToContainer(frame, target), expected);
        close(limitGripTarget(target, frame), expected);
    });

    it('rejects invalid dimensions and rotations atomically', () => {
        expect(() => solverContainerFrame({
            position: [0, 0, 0], orientation: [0, 0, 0, 1], dimensions: [1, 0, 1]
        })).toThrow(/positive finite/);
        expect(() => solverContainerFrame({
            position: [0, 0, 0], orientation: [0, 0, 0, 0], dimensions: [1, 1, 1]
        })).toThrow(/non-zero finite quaternion/);
    });
});

describe('legacy tank adaptation', () => {
    it('keeps the old axis-aligned tank open at the top', () => {
        const frame = solverContainerFrame({ min: [-2, 0, -1], max: [2, 3, 1] });
        expect(frame.closedTop).toBe(false);
        close(frame.position, [0, 1.5, 0]);
        close(frame.halfSize, [2, 1.5, 1]);

        const above = [0, 4, 0];
        close(resolveContainerContact(frame, above, above, 0), above);
    });
});
