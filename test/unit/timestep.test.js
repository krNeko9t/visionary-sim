import { describe, expect, it } from 'vitest';

import {
    FixedTimestep,
    MAX_STEP_DURATION,
    MAX_STEPS_PER_FRAME,
    TARGET_CFL,
    stableStepDuration
} from '../../src/sim/solver/timestep.js';

/** Feeds exactly `seconds` of wall time at a constant render refresh. */
function atRefresh(hz, seconds, stepDuration = 1 / 500) {
    const clock = new FixedTimestep(stepDuration);
    for (let frame = 0; frame < hz * seconds; frame++) {
        clock.consume(1 / hz);
    }
    return clock.snapshot();
}

describe('the fixed physical timestep', () => {
    it('turns the limiting wave rate into a stable, accuracy-bounded duration', () => {
        const breadRate = 383.7879251340593;
        const duration = stableStepDuration(breadRate);

        expect(duration * breadRate).toBeCloseTo(TARGET_CFL, 12);
        expect(duration).toBeLessThanOrEqual(MAX_STEP_DURATION);
        expect(stableStepDuration(0)).toBe(MAX_STEP_DURATION);
        expect(stableStepDuration(1)).toBe(MAX_STEP_DURATION);
    });

    it('simulates the same time at 30, 38, 60 and 144 Hz', () => {
        const reports = [30, 38, 60, 144].map(hz => atRefresh(hz, 3));

        for (const report of reports) {
            expect(report.steps).toBeLessThanOrEqual(MAX_STEPS_PER_FRAME);
            expect(report.simulatedTime).toBeCloseTo(3, 10);
            expect(report.backlogTime).toBeCloseTo(0, 10);
            expect(report.droppedTime).toBe(0);
        }
        expect(new Set(reports.map(report => report.totalSteps)).size).toBe(1);
    });

    it('keeps one duration through irregular frames and a missed refresh', () => {
        const stepDuration = 1 / 512;
        const clock = new FixedTimestep(stepDuration);
        const frames = [1 / 60, 1 / 58, 1 / 38, 1 / 60, 1 / 30, 1 / 144, 1 / 60];
        let elapsed = 0;

        for (const dt of frames) {
            elapsed += dt;
            const report = clock.consume(dt);
            expect(report.stepDuration).toBe(stepDuration);
            expect(report.steps).toBeLessThanOrEqual(MAX_STEPS_PER_FRAME);
            expect(report.droppedTime).toBe(0);
        }

        const report = clock.snapshot();
        expect(report.simulatedTime + report.backlogTime).toBeCloseTo(elapsed, 12);
    });

    it('bounds a long stall without ever enlarging the physical step', () => {
        const stepDuration = 0.002;
        const clock = new FixedTimestep(stepDuration);
        const report = clock.consume(0.2);

        expect(report.steps).toBe(MAX_STEPS_PER_FRAME);
        expect(report.stepDuration).toBe(stepDuration);
        expect(report.overloaded).toBe(true);
        expect(report.frameDroppedTime).toBeCloseTo(0.152, 12);
        expect(report.backlogTime).toBeLessThan(stepDuration);
        expect(report.simulatedTime + report.backlogTime + report.droppedTime).toBeCloseTo(0.2, 12);
    });

    it('does not accumulate while idle and advances one quantum on request', () => {
        const clock = new FixedTimestep(0.002);
        clock.consume(0.001);
        const before = clock.snapshot();

        clock.idle();
        expect(clock.snapshot().backlogTime).toBe(before.backlogTime);
        expect(clock.snapshot().simulatedTime).toBe(before.simulatedTime);

        const stepped = clock.singleStep();
        expect(stepped.steps).toBe(1);
        expect(stepped.simulatedTime).toBeCloseTo(0.002, 12);
        expect(stepped.backlogTime).toBe(before.backlogTime);
    });

    it('forceStep guarantees one step without hiding elapsed time', () => {
        const clock = new FixedTimestep(0.1);
        const report = clock.consume(0.01, { forceStep: true });

        expect(report.steps).toBe(1);
        expect(report.simulatedTime).toBeCloseTo(0.1, 12);
        // The forced step didn't touch the accumulator, so the elapsed time
        // it rode in on is still fully accounted for as backlog rather than
        // vanishing.
        expect(report.backlogTime).toBeCloseTo(0.01, 12);
        expect(report.droppedTime).toBe(0);
    });

    it('forceStep does not add a second step when one was already due', () => {
        const clock = new FixedTimestep(0.002);
        const report = clock.consume(0.0025, { forceStep: true });

        expect(report.steps).toBe(1);
        expect(report.backlogTime).toBeCloseTo(0.0005, 12);
    });

    it('preserves accumulated seconds when a material changes the stable duration', () => {
        const clock = new FixedTimestep(0.004);
        clock.consume(0.003);
        clock.setStepDuration(0.001);
        const report = clock.consume(0.001);

        expect(report.steps).toBe(4);
        expect(report.simulatedTime).toBeCloseTo(0.004, 12);
        expect(report.backlogTime).toBeCloseTo(0, 12);
        expect(report.droppedTime).toBe(0);
    });

    it('clones complete accounting into a candidate without changing the live clock', () => {
        const live = new FixedTimestep(0.01, { maxStepsPerFrame: 2 });
        live.consume(0.055);
        const before = live.snapshot();

        const candidate = live.clone({ stepDuration: 0.002 });

        expect(live.snapshot()).toEqual(before);
        expect(candidate.snapshot()).toEqual({
            ...before,
            stepDuration: 0.002
        });

        candidate.consume(0);
        expect(candidate.snapshot().totalSteps).toBeGreaterThan(before.totalSteps);
        expect(live.snapshot()).toEqual(before);
    });

    it('restores a clock atomically and retains fractional, dropped and frame accounting', () => {
        const source = new FixedTimestep(0.01, { maxStepsPerFrame: 2 });
        const saved = source.consume(0.055);
        const target = new FixedTimestep(0.2);

        target.restore(saved, { stepDuration: 0.004 });

        expect(target.snapshot()).toEqual({
            ...saved,
            stepDuration: 0.004
        });

        const beforeInvalidRestore = target.snapshot();
        expect(() => target.restore({ ...saved, backlogTime: Number.NaN }))
            .toThrow(RangeError);
        expect(target.snapshot()).toEqual(beforeInvalidRestore);
    });

    it('rejects values that would make time undefined', () => {
        expect(() => stableStepDuration(-1)).toThrow(RangeError);
        expect(() => new FixedTimestep(0)).toThrow(RangeError);
        expect(() => new FixedTimestep(0.01, { maxStepsPerFrame: 0 })).toThrow(RangeError);
        expect(() => new FixedTimestep(0.01).consume(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    });
});
