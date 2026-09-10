/**
 * Turns irregular render-frame time into fixed simulation steps.
 *
 * The renderer owns when work can be submitted, but it must not own the size of
 * a physical step. XPBD compliance is divided by `dt^2`, so changing `dt` with
 * every render frame changes the constraint being solved: a long frame makes
 * the material harder, a short one makes it softer. This clock keeps that value
 * fixed and lets only the number of steps submitted in a frame vary.
 *
 * This module knows no constraint names and no GPU API. It receives one scalar
 * stability rate in cell-crossings per second and returns plain counts and
 * durations. The simulator is the seam that connects those numbers to the
 * dispatch sequence.
 */

/** CFL kept below one so XPBD projections remain compliance-damped. */
export const TARGET_CFL = 0.75;

/**
 * Accuracy ceiling for very soft scenes: never take fewer than four physical
 * steps per nominal 60 Hz frame merely because CFL would permit it.
 */
export const MAX_STEP_DURATION = 1 / 240;

/**
 * Work admitted into one render frame. At the tightest current scene this
 * covers about 47 ms, including a missed 60 Hz refresh, without entering an
 * unbounded catch-up spiral.
 */
export const MAX_STEPS_PER_FRAME = 24;

/**
 * Fixed physical-step duration for a scene.
 *
 * @param {number} waveRate - Fastest elastic wave in cell crossings per second.
 * @returns {number} Seconds per physical step.
 */
export function stableStepDuration(waveRate) {
    if (!Number.isFinite(waveRate) || waveRate < 0) {
        throw new RangeError(`waveRate must be a finite non-negative number, got ${waveRate}`);
    }
    return waveRate === 0
        ? MAX_STEP_DURATION
        : Math.min(MAX_STEP_DURATION, TARGET_CFL / waveRate);
}

/**
 * Accumulates wall time and plans fixed-size physical steps.
 *
 * Whole steps beyond the per-frame budget are discarded immediately while the
 * fractional remainder is retained. Letting them remain queued would make one
 * slow frame cause more work, then another slow frame, forever. Discarding time
 * is a deliberate real-time policy and is therefore counted and exposed; the
 * clock never hides overload by enlarging a physical step.
 */
export class FixedTimestep {
    /**
     * @param {number} stepDuration - Fixed seconds per physical step.
     * @param {object} [options] - Real-time work budget.
     * @param {number} [options.maxStepsPerFrame] - Maximum steps submitted in one frame.
     */
    constructor(stepDuration, { maxStepsPerFrame = MAX_STEPS_PER_FRAME } = {}) {
        assertStepDuration(stepDuration);
        if (!Number.isInteger(maxStepsPerFrame) || maxStepsPerFrame < 1) {
            throw new RangeError(`maxStepsPerFrame must be a positive integer, got ${maxStepsPerFrame}`);
        }

        this.stepDuration = stepDuration;
        this.maxStepsPerFrame = maxStepsPerFrame;
        this.reset();
    }

    /**
     * Changes the fixed step after material parameters change.
     *
     * Unsimulated fractional wall time is kept in seconds. Reinterpreting it as
     * a fraction of the new step would create or destroy elapsed time.
     *
     * @param {number} stepDuration - New fixed seconds per physical step.
     */
    setStepDuration(stepDuration) {
        assertStepDuration(stepDuration);
        this.stepDuration = stepDuration;
    }

    /**
     * Adds one render frame's elapsed time and plans its physical work.
     *
     * @param {number} elapsed - Wall time since the previous render frame, seconds.
     * @param {object} [options] - Planning override.
     * @param {boolean} [options.forceStep] - Guarantee at least one step this
     *   frame, on top of the ordinary accounting below rather than instead of
     *   it: `elapsed` is still banked, dropped or simulated exactly as it
     *   would be without the flag, so a forced step never makes wall time
     *   disappear -- it only lets a manual single-step request go through on
     *   a frame that would otherwise have produced zero steps.
     * @returns {ReturnType<FixedTimestep['snapshot']>} Current clock report.
     */
    consume(elapsed, { forceStep = false } = {}) {
        if (!Number.isFinite(elapsed) || elapsed < 0) {
            throw new RangeError(`elapsed must be a finite non-negative number, got ${elapsed}`);
        }

        this.accumulator += elapsed;
        const epsilon = this.stepDuration * 1e-9;
        const available = Math.floor((this.accumulator + epsilon) / this.stepDuration);
        let steps = Math.min(available, this.maxStepsPerFrame);
        const droppedSteps = available - steps;
        const consumedSteps = steps + droppedSteps;

        this.accumulator -= consumedSteps * this.stepDuration;
        // `epsilon` admits exact boundaries despite accumulated rounding. Do
        // not expose the tiny negative residue it can leave as negative backlog.
        if (this.accumulator < 0 && this.accumulator > -epsilon) {
            this.accumulator = 0;
        }

        if (forceStep && steps === 0) {
            steps = 1;
        }

        this.lastSteps = steps;
        this.lastElapsed = elapsed;
        this.lastDroppedTime = droppedSteps * this.stepDuration;
        this.simulatedTime += steps * this.stepDuration;
        this.totalSteps += steps;
        this.droppedTime += this.lastDroppedTime;
        return this.snapshot();
    }

    /** Records a render frame during which simulation is paused. */
    idle() {
        this.lastSteps = 0;
        this.lastElapsed = 0;
        this.lastDroppedTime = 0;
        return this.snapshot();
    }

    /** Plans exactly one physical step without consuming wall time. */
    singleStep() {
        this.lastSteps = 1;
        this.lastElapsed = 0;
        this.lastDroppedTime = 0;
        this.simulatedTime += this.stepDuration;
        this.totalSteps++;
        return this.snapshot();
    }

    /** Clears accumulated, simulated and discarded time. */
    reset() {
        this.accumulator = 0;
        this.simulatedTime = 0;
        this.totalSteps = 0;
        this.droppedTime = 0;
        this.lastSteps = 0;
        this.lastElapsed = 0;
        this.lastDroppedTime = 0;
    }

    /**
     * Restores a previously reported clock without consuming wall time.
     *
     * Every value is validated before this instance changes, so a failed
     * candidate preparation cannot leave a partially restored clock. The step
     * duration may be replaced for a candidate scene whose strictest body has
     * changed; all accounting remains measured in seconds.
     *
     * @param {ReturnType<FixedTimestep['snapshot']>} saved - Public clock snapshot.
     * @param {object} [options] - Candidate clock settings.
     * @param {number} [options.stepDuration] - Stable duration for future steps.
     * @returns {ReturnType<FixedTimestep['snapshot']>} Restored report.
     */
    restore(saved, { stepDuration = saved?.stepDuration } = {}) {
        const state = restoredState(saved, stepDuration);

        this.stepDuration = state.stepDuration;
        this.maxStepsPerFrame = state.maxStepsPerFrame;
        this.accumulator = state.accumulator;
        this.simulatedTime = state.simulatedTime;
        this.totalSteps = state.totalSteps;
        this.droppedTime = state.droppedTime;
        this.lastSteps = state.lastSteps;
        this.lastElapsed = state.lastElapsed;
        this.lastDroppedTime = state.lastDroppedTime;
        return this.snapshot();
    }

    /**
     * Creates an independent candidate clock with the same complete accounting.
     * Mutating or discarding it never changes the live simulation clock.
     *
     * @param {object} [options] - Candidate clock settings.
     * @param {number} [options.stepDuration] - Stable duration for future steps.
     * @returns {FixedTimestep} Independent restored clock.
     */
    clone({ stepDuration = this.stepDuration } = {}) {
        const candidate = new FixedTimestep(stepDuration, {
            maxStepsPerFrame: this.maxStepsPerFrame
        });
        candidate.restore(this.snapshot(), { stepDuration });
        return candidate;
    }

    /**
     * @returns {{ stepDuration: number, maxStepsPerFrame: number, steps: number,
     *   elapsed: number, totalSteps: number, simulatedTime: number, backlogTime: number,
     *   frameDroppedTime: number, droppedTime: number, overloaded: boolean }}
     *   Plain state for dispatch and reporting.
     */
    snapshot() {
        return {
            stepDuration: this.stepDuration,
            maxStepsPerFrame: this.maxStepsPerFrame,
            steps: this.lastSteps,
            elapsed: this.lastElapsed,
            totalSteps: this.totalSteps,
            simulatedTime: this.simulatedTime,
            backlogTime: this.accumulator,
            frameDroppedTime: this.lastDroppedTime,
            droppedTime: this.droppedTime,
            overloaded: this.lastDroppedTime > 0
        };
    }
}

/** @param {number} value - Candidate fixed step duration. */
function assertStepDuration(value) {
    if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`stepDuration must be a finite positive number, got ${value}`);
    }
}

function restoredState(saved, stepDuration) {
    if (!saved || typeof saved !== 'object') {
        throw new TypeError('clock snapshot must be an object');
    }
    assertStepDuration(stepDuration);
    assertPositiveInteger(saved.maxStepsPerFrame, 'maxStepsPerFrame');
    assertNonNegativeInteger(saved.steps, 'steps');
    assertNonNegativeInteger(saved.totalSteps, 'totalSteps');
    assertNonNegativeFinite(saved.elapsed, 'elapsed');
    assertNonNegativeFinite(saved.simulatedTime, 'simulatedTime');
    assertNonNegativeFinite(saved.backlogTime, 'backlogTime');
    assertNonNegativeFinite(saved.frameDroppedTime, 'frameDroppedTime');
    assertNonNegativeFinite(saved.droppedTime, 'droppedTime');
    if (saved.frameDroppedTime > saved.droppedTime) {
        throw new RangeError('frameDroppedTime cannot exceed droppedTime');
    }

    return {
        stepDuration,
        maxStepsPerFrame: saved.maxStepsPerFrame,
        accumulator: saved.backlogTime,
        simulatedTime: saved.simulatedTime,
        totalSteps: saved.totalSteps,
        droppedTime: saved.droppedTime,
        lastSteps: saved.steps,
        lastElapsed: saved.elapsed,
        lastDroppedTime: saved.frameDroppedTime
    };
}

function assertNonNegativeFinite(value, name) {
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(`${name} must be a finite non-negative number, got ${value}`);
    }
}

function assertNonNegativeInteger(value, name) {
    if (!Number.isInteger(value) || value < 0) {
        throw new RangeError(`${name} must be a non-negative integer, got ${value}`);
    }
}

function assertPositiveInteger(value, name) {
    if (!Number.isInteger(value) || value < 1) {
        throw new RangeError(`${name} must be a positive integer, got ${value}`);
    }
}
