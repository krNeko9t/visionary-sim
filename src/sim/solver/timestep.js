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
     * @returns {ReturnType<FixedTimestep['snapshot']>} Current clock report.
     */
    consume(elapsed) {
        if (!Number.isFinite(elapsed) || elapsed < 0) {
            throw new RangeError(`elapsed must be a finite non-negative number, got ${elapsed}`);
        }

        this.accumulator += elapsed;
        const epsilon = this.stepDuration * 1e-9;
        const available = Math.floor((this.accumulator + epsilon) / this.stepDuration);
        const steps = Math.min(available, this.maxStepsPerFrame);
        const droppedSteps = available - steps;
        const consumedSteps = steps + droppedSteps;

        this.accumulator -= consumedSteps * this.stepDuration;
        // `epsilon` admits exact boundaries despite accumulated rounding. Do
        // not expose the tiny negative residue it can leave as negative backlog.
        if (this.accumulator < 0 && this.accumulator > -epsilon) {
            this.accumulator = 0;
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
