/**
 * What a recorded reference is and how a run is held against it. Pure, so the
 * judgement the browser gate makes is itself tested without a browser.
 *
 * A run is node positions -- three floats per node, in metres -- at a few
 * checkpoint steps of one scenario. The reference is one recorded run, and
 * each of its checkpoints carries the tolerance it allows.
 */

/** Where a failing comparison sends its reader. */
const README = 'test/motion-reference/README.md';

/**
 * @typedef {object} Checkpoint
 * @property {number} step - Fixed physical steps taken before it.
 * @property {Float32Array} positions - Node positions, xyz per node.
 * @property {number} [tolerance] - On a reference: the largest node distance,
 *   in metres, a run may show here.
 */

/**
 * @typedef {object} Run
 * @property {string} scenario - Which scenario.
 * @property {number} dt - Seconds per fixed physical step.
 * @property {Checkpoint[]} checkpoints - In step order.
 */

/**
 * @param {number} metres - A distance.
 * @returns {string} It in millimetres, to four significant figures.
 */
const mm = metres => `${(metres * 1000).toPrecision(4)} mm`;

/**
 * @param {Float32Array} a - Positions, xyz per node.
 * @param {Float32Array} b - The same nodes elsewhere.
 * @returns {{ distance: number, node: number }} The node that moved furthest
 *   between the two, and how far. A non-finite coordinate is infinitely far.
 */
function furthest(a, b) {
    let distance = 0;
    let node = -1;
    for (let n = 0; n < a.length / 3; n++) {
        const d = Math.hypot(a[n * 3] - b[n * 3], a[n * 3 + 1] - b[n * 3 + 1], a[n * 3 + 2] - b[n * 3 + 2]);
        const far = Number.isNaN(d) ? Infinity : d;
        if (far > distance) {
            distance = far;
            node = n;
        }
    }
    return { distance, node };
}

/**
 * @param {Run & { checkpoints: Required<Checkpoint>[] }} reference - The recording.
 * @param {Run} run - A new run of the same scenario.
 * @returns {{ checkpoints: { step: number, distance: number, node: number, tolerance: number }[],
 *   problems: string[] }} How far each checkpoint is from the reference, and
 *   every way the run fails, each saying what to do.
 */
export function compareRun(reference, run) {
    const { scenario } = reference;
    const mismatch = shapeMismatch(reference, run);
    if (mismatch) {
        return { checkpoints: [], problems: [`${mismatch} See "When it fails" in ${README}.`] };
    }
    const checkpoints = reference.checkpoints.map((expected, i) => {
        const { distance, node } = furthest(expected.positions, run.checkpoints[i].positions);
        return { step: expected.step, distance, node, tolerance: expected.tolerance };
    });
    const problems = checkpoints
        .filter(({ distance, tolerance }) => !(distance <= tolerance))
        .map(({ step, distance, node, tolerance }) => `${scenario} at step ${step}: node ${node} ` +
            (Number.isFinite(distance) ? `is ${mm(distance)} from the reference, ` : 'is not finite, ') +
            `${mm(tolerance)} is allowed. See "When it fails" in ${README}.`);
    return { checkpoints, problems };
}

/**
 * How two runs of a scenario differ before any motion is compared. These are
 * decided on the CPU before the GPU takes a step, so no GPU backend can cause
 * them, and node-by-node distances mean nothing until they match.
 *
 * @param {Run} a - One run.
 * @param {Run} b - Another run of the same scenario.
 * @returns {string|null} What differs, or null.
 */
function shapeMismatch(a, b) {
    const nodes = ({ checkpoints }) => checkpoints[0].positions.length / 3;
    const steps = ({ checkpoints }) => checkpoints.map(({ step }) => step).join(', ');
    if (steps(b) !== steps(a)) {
        return `${a.scenario}: checkpoints at steps ${steps(b)}, against ${steps(a)}: the scenario itself changed.`;
    }
    if (nodes(b) !== nodes(a)) {
        return `${a.scenario}: the bodies were cut into ${nodes(b)} nodes, against ${nodes(a)} nodes: ` +
            'the discretisation changed.';
    }
    if (b.dt !== a.dt) {
        return `${a.scenario}: each step is ${b.dt} s, against ${a.dt} s: materials or discretisation set ` +
            'a different step duration.';
    }
    return null;
}

/** How {@link recordReference} sets each checkpoint's tolerance, as `conditions.json` records it. */
export const TOLERANCE_RULE = 'twice the furthest any repeat strayed from the first, per checkpoint';

/**
 * Makes a reference out of repeated runs of one implementation: the first run,
 * with each checkpoint allowing twice the furthest any repeat strayed from it
 * there. Repeats that agree bit for bit allow nothing, and the reference is
 * then exact. Twice rather than once because a handful of repeats is unlikely
 * to have met the largest scatter the implementation can produce.
 *
 * @param {Run[]} runs - Two or more runs of one scenario on one implementation.
 * @returns {Run} The reference, each checkpoint with `spread` (the furthest a
 *   repeat strayed) and `tolerance`.
 */
export function recordReference(runs) {
    const [first, ...repeats] = runs;
    for (const repeat of repeats) {
        const mismatch = shapeMismatch(first, repeat);
        if (mismatch) throw new Error(`Repeats of one implementation disagree. ${mismatch}`);
    }
    return {
        ...first,
        checkpoints: first.checkpoints.map((checkpoint, i) => {
            const spread = Math.max(0, ...repeats.map(repeat => furthest(checkpoint.positions, repeat.checkpoints[i].positions).distance));
            return { ...checkpoint, spread, tolerance: 2 * spread };
        })
    };
}

/**
 * @typedef {object} Conditions
 * @property {string} [commit] - The sim commit a recording was made on.
 * @property {string} browser - Browser and version.
 * @property {object} adapter - The WebGPU adapter the page actually used.
 * @property {{ driverVersion: string }[]} gpu - Every GPU the system reports.
 * @property {Record<string, string>} assets - SHA-256 of each asset, by path.
 */

/**
 * Holds what a run depends on besides the code against the recording.
 *
 * @param {Conditions} recorded - Conditions at recording.
 * @param {Conditions} now - Conditions of this run.
 * @returns {{ problems: string[], elsewhere: string|null }} Input that differs,
 *   which fails the comparison by itself; and, when browser, driver or adapter
 *   differ, what to rule out first should the motion differ too.
 */
export function compareConditions(recorded, now) {
    const problems = Object.entries(recorded.assets)
        .filter(([path, hash]) => now.assets[path] !== hash)
        .map(([path, hash]) => `${path} is not the file the reference was recorded with (SHA-256 ${hash}); ` +
            'supply that file, the comparison means nothing on other input.');
    const drivers = ({ gpu }) => JSON.stringify(gpu.map(({ driverVersion }) => driverVersion));
    const moved = now.browser !== recorded.browser || drivers(now) !== drivers(recorded) ||
        JSON.stringify(now.adapter) !== JSON.stringify(recorded.adapter);
    const elsewhere = moved
        ? `This browser, GPU driver or adapter is not the one recorded (${recorded.browser}, ` +
          `${JSON.stringify(recorded.adapter)}). A different shader compiler can move results by itself: ` +
          `re-record on ${recorded.commit} in this environment first (${README}) to tell the two apart.`
        : null;
    return { problems, elsewhere };
}

/**
 * @param {{ scenario: string, script: unknown[], batch: number }} recorded - A recorded scenario.
 * @param {unknown[]} script - What `scenarios.js` plays today.
 * @param {number} batch - Steps per frame today.
 * @returns {string|null} Why the recording no longer describes the scenario, or null.
 */
export function scriptChanged(recorded, script, batch) {
    if (JSON.stringify(recorded.script) === JSON.stringify(script) && recorded.batch === batch) {
        return null;
    }
    return `${recorded.scenario}: scenarios.js no longer plays what was recorded; re-record on the old ` +
        `implementation (${README}) in the change that edits the scenario.`;
}
