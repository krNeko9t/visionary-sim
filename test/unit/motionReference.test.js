import { describe, expect, it } from 'vitest';

import { compareRun, recordReference } from '../motion-reference/reference.js';

/**
 * One run of a scenario as the browser page reports it: node positions, three
 * floats per node, at each checkpoint step.
 */
function run(checkpoints, { dt = 0.001, scenario = 'tank' } = {}) {
    return {
        scenario,
        dt,
        checkpoints: checkpoints.map(([step, positions]) => ({ step, positions: Float32Array.from(positions) }))
    };
}

/** A recorded reference: one run plus the tolerance each checkpoint allows. */
function reference(checkpoints, tolerances, options) {
    const recorded = run(checkpoints, options);
    recorded.checkpoints.forEach((checkpoint, i) => { checkpoint.tolerance = tolerances[i]; });
    return recorded;
}

describe('comparing a run with the recorded reference', () => {
    const rest = [0, 0, 0, 1, 0, 0];
    const later = [0, -0.1, 0, 1, -0.1, 0];
    const recorded = reference([[0, rest], [100, later]], [0, 1e-4]);

    it('accepts a run within each checkpoint\'s tolerance', () => {
        const nearly = [0, -0.1, 0, 1, -0.1 + 5e-5, 0];
        expect(compareRun(recorded, run([[0, rest], [100, nearly]])).problems).toEqual([]);
    });

    it('rejects a run that moved further, naming where and saying what to do', () => {
        const { problems } = compareRun(recorded, run([[0, rest], [100, [0, -0.1, 0, 1, -0.09, 0]]]));
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/tank/);
        expect(problems[0]).toMatch(/step 100/);
        expect(problems[0]).toMatch(/node 1/);
        expect(problems[0]).toMatch(/10\.00 mm/);
        expect(problems[0]).toMatch(/README/);
    });

    it('reports a different cut of the body as that, not as motion', () => {
        const { problems } = compareRun(recorded, run([[0, [...rest, 2, 0, 0]], [100, [...later, 2, -0.1, 0]]]));
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/3 nodes.*2 nodes|2 nodes.*3 nodes/);
        expect(problems[0]).toMatch(/discretis/);
    });

    it('reports a different step duration as that, not as motion', () => {
        const { problems } = compareRun(recorded, run([[0, rest], [100, later]], { dt: 0.002 }));
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/0\.002.*0\.001|0\.001.*0\.002/);
    });

    it('rejects positions that are not finite', () => {
        const { problems } = compareRun(recorded, run([[0, rest], [100, [0, NaN, 0, 1, -0.1, 0]]]));
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/node 0.*not finite/);
    });
});

describe('recording a reference from repeated runs of one implementation', () => {
    const rest = [0, 0, 0, 1, 0, 0];
    const later = [0, -0.1, 0, 1, -0.1, 0];

    it('allows nothing where the repeats agreed bit for bit', () => {
        const recorded = recordReference([run([[0, rest], [100, later]]), run([[0, rest], [100, later]])]);
        expect(recorded.checkpoints.map(({ spread, tolerance }) => [spread, tolerance])).toEqual([[0, 0], [0, 0]]);
        expect(compareRun(recorded, run([[0, rest], [100, later]])).problems).toEqual([]);
    });

    it('allows twice the furthest any repeat strayed from the first, checkpoint by checkpoint', () => {
        const strayed = [0, -0.1, 0, 1, -0.1 + 0.001, 0];
        const recorded = recordReference([run([[0, rest], [100, later]]), run([[0, rest], [100, strayed]])]);
        expect(recorded.checkpoints[0].tolerance).toBe(0);
        expect(recorded.checkpoints[1].spread).toBeCloseTo(0.001, 6);
        expect(recorded.checkpoints[1].tolerance).toBeCloseTo(0.002, 6);
        expect(recorded.checkpoints[1].positions).toEqual(Float32Array.from(later));
    });

    it('refuses repeats that do not even agree on the scenario\'s shape', () => {
        expect(() => recordReference([run([[0, rest]]), run([[0, [...rest, 2, 0, 0]]])])).toThrow(/nodes/);
    });
});
