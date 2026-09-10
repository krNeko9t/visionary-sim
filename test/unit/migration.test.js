import { describe, expect, it, vi } from 'vitest';

import {
    copyParticleMigration,
    planParticleMigration
} from '../../src/sim/state/migration.js';

function body(id, restPositions) {
    return {
        id,
        nodeCount: restPositions.length / 3,
        restPositions: Float32Array.from(restPositions)
    };
}

function particleBuffers(prefix) {
    const make = name => ({
        name: `${prefix}.${name}`,
        copy: vi.fn(),
        read: vi.fn(() => { throw new Error('migration must not read back'); }),
        destroy: vi.fn()
    });
    return {
        nodePos: make('nodePos'),
        nodePrev: make('nodePrev'),
        nodeVel: make('nodeVel'),
        nodeInvMass: make('nodeInvMass'),
        nodeParams: make('nodeParams')
    };
}

describe('particle state migration', () => {
    it('maps stable bodies while leaving appended bodies at candidate initialization', () => {
        const a = body(7, [0, 0, 0, 1, 0, 0]);
        const b = body(11, [0, 1, 0]);
        const added = body(13, [2, 0, 0, 2, 1, 0, 2, 2, 0]);

        const plan = planParticleMigration([a, b], [b, added, a]);

        expect(plan.ranges).toEqual([
            { id: 7, sourceNodeOffset: 0, destinationNodeOffset: 4, nodeCount: 2 },
            { id: 11, sourceNodeOffset: 2, destinationNodeOffset: 0, nodeCount: 1 }
        ]);
        expect(plan.addedIds).toEqual([13]);
    });

    it('copies position, previous position and velocity directly between GPU buffers', () => {
        const previous = particleBuffers('old');
        const candidate = particleBuffers('candidate');
        const plan = {
            ranges: [
                { id: 7, sourceNodeOffset: 2, destinationNodeOffset: 5, nodeCount: 3 }
            ]
        };

        copyParticleMigration(previous, candidate, plan);

        for (const field of ['nodePos', 'nodePrev', 'nodeVel']) {
            expect(candidate[field].copy).toHaveBeenCalledExactlyOnceWith(
                previous[field], 2 * 16, 5 * 16, 3 * 16
            );
        }
        expect(candidate.nodeInvMass.copy).not.toHaveBeenCalled();
        expect(candidate.nodeParams.copy).not.toHaveBeenCalled();
        expect(Object.values(previous).every(buffer => buffer.read.mock.calls.length === 0)).toBe(true);
        expect(Object.values(previous).every(buffer => buffer.destroy.mock.calls.length === 0)).toBe(true);
        expect(Object.values(candidate).every(buffer => buffer.destroy.mock.calls.length === 0)).toBe(true);
    });

    it('rejects replacing an old rest shape with its deformed state', () => {
        const original = body('A', [0, 0, 0, 1, 0, 0]);
        const deformed = body('A', [0, 0, 0, 1.2, 0, 0]);

        expect(() => planParticleMigration([original], [deformed]))
            .toThrow(/rest positions changed/i);
    });

    it('rejects missing, duplicated and resized old bodies before recording copies', () => {
        const a = body('A', [0, 0, 0]);
        const resized = body('A', [0, 0, 0, 1, 0, 0]);

        expect(() => planParticleMigration([a], []))
            .toThrow(/missing old body/i);
        expect(() => planParticleMigration([a], [a, a]))
            .toThrow(/duplicate body id/i);
        expect(() => planParticleMigration([a], [resized]))
            .toThrow(/node count changed/i);
    });

    it('does not release either owner if a candidate copy cannot be recorded', () => {
        const previous = particleBuffers('old');
        const candidate = particleBuffers('candidate');
        candidate.nodePrev.copy.mockImplementation(() => { throw new Error('encoder rejected copy'); });

        expect(() => copyParticleMigration(previous, candidate, {
            ranges: [{ id: 'A', sourceNodeOffset: 0, destinationNodeOffset: 1, nodeCount: 1 }]
        })).toThrow('encoder rejected copy');

        expect(Object.values(previous).every(buffer => buffer.destroy.mock.calls.length === 0)).toBe(true);
        expect(Object.values(candidate).every(buffer => buffer.destroy.mock.calls.length === 0)).toBe(true);
    });
});
