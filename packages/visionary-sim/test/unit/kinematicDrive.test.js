import { describe, expect, it, vi } from 'vitest';

import { Particles } from '../../src/sim/state/particles.js';
import driveCompliantWgsl from '../../src/sim/constraints/wgsl/driveCompliant.wgsl?raw';

/**
 * What the kinematic drive constraint promises, in the two halves it actually
 * has.
 *
 * The two drive laws live in `sim/constraints/wgsl/driveHard.wgsl` and
 * `driveCompliant.wgsl` and cannot run here, so this file carries a
 * transcription of each -- the same status as the WGSL copies of `cellCoords`
 * and `resolvePair` elsewhere in this suite, kept honest the same way, by
 * reading the two side by side.
 *
 * The seam the hard law leans on -- `Particles.setPrescribed`, in
 * `sim/state/particles.js` -- is not WGSL and needs no transcription. It is
 * exercised directly, the way `simulatorTiming.test.js` runs `Simulator`'s own
 * methods: a hand-built object standing in for a `Particles` instance, with
 * `Particles.prototype`'s real methods called against it. Constructing an
 * actual `Particles` would allocate real GPU buffers, which is exactly what
 * these tests do not need in order to check this arithmetic.
 *
 * What the coupled elastic projection does with a prescribed corner --
 * whether the *other* three corners of a cell get the full correction once a
 * driven node's weight is properly zero, rather than a share diminished by a
 * weight that was going to be discarded anyway -- is `elastic.test.js`'s
 * question, answered there, because that is where the machinery to ask it
 * already lives.
 */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * CPU transcription of `wgsl/driveHard.wgsl`. `goal` is `grabTarget +
 * offset`, already summed -- the kernel's own addition is nothing more than
 * that.
 *
 * @param {number[]} here - The node's current position.
 * @param {number[]} goal - Where it should end up.
 * @param {number[]} velocity - The grab target's velocity this frame.
 * @param {number} dt - Substep duration.
 * @returns {{ position: number[], velocity: number[] }} What the kernel writes.
 */
function driveHard(here, goal, velocity, dt) {
    const step = scale(velocity, dt);
    const toGoal = sub(goal, here);
    const next = dot(step, step) >= dot(toGoal, toGoal) ? add(here, toGoal) : add(here, step);
    return { position: next, velocity: scale(sub(next, here), 1 / dt) };
}

/**
 * CPU transcription of `wgsl/driveCompliant.wgsl`.
 *
 * @param {number[]} p - The node's current position.
 * @param {number[]} goal - Where the grab target would like it.
 * @param {number} dt - Substep duration.
 * @param {number} responseTime - Compliant law's `tau`.
 * @returns {number[]} The corrected position.
 */
function driveCompliant(p, goal, dt, responseTime) {
    const frac = (dt * dt) / (dt * dt + responseTime * responseTime);
    return add(p, scale(sub(goal, p), frac));
}

describe('the hard drive law', () => {
    const DT = 1 / 1200;

    it('advances by exactly the grab target velocity when the goal is still far off', () => {
        const velocity = [1, 0, 0];
        const { position } = driveHard([0, 0, 0], [10, 0, 0], velocity, DT);

        expect(position).toEqual([velocity[0] * DT, 0, 0]);
    });

    it('lands exactly on the goal rather than overshooting it', () => {
        const goal = [0.001, -0.0002, 0];
        // Fast enough to cover the whole remaining distance this substep.
        const velocity = scale(goal, 1e6);
        const { position } = driveHard([0, 0, 0], goal, velocity, DT);

        expect(position).toEqual(goal);
    });

    it('reaches a goal in exactly the substeps its own velocity implies', () => {
        const steps = 20;
        const goal = [0.012, -0.02, 0.005];
        const velocity = scale(goal, 1 / (steps * DT));

        let here = [0, 0, 0];
        for (let s = 0; s < steps; s++) {
            here = driveHard(here, goal, velocity, DT).position;
        }

        expect(here[0]).toBeCloseTo(goal[0], 12);
        expect(here[1]).toBeCloseTo(goal[1], 12);
        expect(here[2]).toBeCloseTo(goal[2], 12);
    });

    it('keeps the grab target\'s velocity as its own while still travelling, so a release lets it fly', () => {
        const velocity = [0.3, -0.1, 0.2];
        // A goal far enough away that this substep does not land on it.
        const { velocity: nodeVelocity } = driveHard([0, 0, 0], [10, 10, 10], velocity, DT);

        expect(nodeVelocity[0]).toBeCloseTo(velocity[0], 9);
        expect(nodeVelocity[1]).toBeCloseTo(velocity[1], 9);
        expect(nodeVelocity[2]).toBeCloseTo(velocity[2], 9);
    });

    it('reports zero velocity once the grab target itself is still', () => {
        const { position, velocity } = driveHard([1, 2, 3], [1, 2, 3], [0, 0, 0], DT);

        expect(position).toEqual([1, 2, 3]);
        expect(velocity).toEqual([0, 0, 0]);
    });
});

describe('the offset that keeps a held set rigid', () => {
    it('keeps two held nodes\' separation fixed as the grab target moves', () => {
        const dt = 1 / 1200;
        const offsetA = [0.01, 0, 0];
        const offsetB = [-0.02, 0.03, 0];
        const target1 = [0, 0, 0];
        const target2 = [0.05, -0.01, 0.02];

        const posA1 = add(target1, offsetA);
        const posB1 = add(target1, offsetB);

        // Sized to land exactly on the new goal in one substep.
        const velocity = scale(sub(target2, target1), 1 / dt);
        const posA2 = driveHard(posA1, add(target2, offsetA), velocity, dt).position;
        const posB2 = driveHard(posB1, add(target2, offsetB), velocity, dt).position;

        const before = sub(posA1, posB1);
        const after = sub(posA2, posB2);
        expect(after[0]).toBeCloseTo(before[0], 12);
        expect(after[1]).toBeCloseTo(before[1], 12);
        expect(after[2]).toBeCloseTo(before[2], 12);
    });
});

describe('the compliant drive law', () => {
    const DT = 1 / 1200;
    const TAU = 0.05;

    it('agrees with the closed form dt^2 / (dt^2 + tau^2)', () => {
        const goal = [1, -0.5, 0.25];
        const after = driveCompliant([0, 0, 0], goal, DT, TAU);
        const frac = (DT * DT) / (DT * DT + TAU * TAU);

        expect(after).toEqual(scale(goal, frac));
    });

    it('closes the same fraction of the distance whether it is near or far', () => {
        const near = driveCompliant([0, 0, 0], [0.01, 0, 0], DT, TAU);
        const far = driveCompliant([0, 0, 0], [1, 0, 0], DT, TAU);

        expect(near[0] / 0.01).toBeCloseTo(far[0] / 1, 12);
    });

    it('reduces to the hard law\'s goal as the response time shrinks to zero', () => {
        const goal = [1, 2, 3];
        expect(driveCompliant([0, 0, 0], goal, DT, 0)).toEqual(goal);
    });

    it('leaves position alone as the response time grows without bound', () => {
        const p = [1, 1, 1];
        const after = driveCompliant(p, [5, 5, 5], DT, 1e6);

        expect(after[0]).toBeCloseTo(p[0], 6);
        expect(after[1]).toBeCloseTo(p[1], 6);
        expect(after[2]).toBeCloseTo(p[2], 6);
    });

    it('never reads a node\'s inverse mass, because the correction does not depend on it', () => {
        // The derivation above shows the mass cancels out of the update
        // exactly, for any weight. The kernel does not even carry the
        // ingredient that would let it disagree with that: `driveHard.wgsl`
        // needs no such check, since it never touches invMass either -- what
        // it drives is prescribed to zero before it ever runs.
        expect(driveCompliantWgsl).not.toMatch(/nodeInvMass/);
    });
});

/**
 * @param {number[]} invMass - Starting inverse mass per node.
 * @returns {object} Enough of a `Particles` to run its prototype methods
 *   against, without allocating a GPU buffer.
 */
function fakeParticles(invMass) {
    const arr = Float32Array.from(invMass);
    return {
        invMass: arr,
        gpuInvMass: Float32Array.from(arr),
        prescribed: new Set(),
        staticPrescribed: new Set(),
        bodies: [{ nodeCount: arr.length, invMass: arr }],
        offsets: [0],
        nodeInvMass: { write: vi.fn() },
        // setPrescribed/clearPrescribed/uploadMasses all call this.uploadGpuMasses();
        // real production code, called the same way Particles.prototype.setPrescribed
        // itself does.
        uploadGpuMasses: Particles.prototype.uploadGpuMasses
    };
}

describe('the prescribed set sim/state offers a constraint', () => {
    it('zeroes exactly the prescribed nodes on the GPU-facing copy, leaving the material truth alone', () => {
        const particles = fakeParticles([1, 2, 3, 4]);

        Particles.prototype.setPrescribed.call(particles, [1, 3]);

        expect(Array.from(particles.gpuInvMass)).toEqual([1, 0, 3, 0]);
        expect(Array.from(particles.invMass)).toEqual([1, 2, 3, 4]);
        expect(particles.nodeInvMass.write).toHaveBeenLastCalledWith(0, particles.gpuInvMass);
    });

    it('gives every node its mass back once cleared', () => {
        const particles = fakeParticles([1, 2, 3, 4]);
        Particles.prototype.setPrescribed.call(particles, [0, 2]);

        Particles.prototype.clearPrescribed.call(particles);

        expect(Array.from(particles.gpuInvMass)).toEqual([1, 2, 3, 4]);
    });

    it('replaces whatever was prescribed before rather than adding to it', () => {
        const particles = fakeParticles([1, 1, 1, 1]);
        Particles.prototype.setPrescribed.call(particles, [0]);

        Particles.prototype.setPrescribed.call(particles, [2]);

        expect(Array.from(particles.gpuInvMass)).toEqual([1, 1, 0, 1]);
    });

    it('does not let a mass update revive a node a constraint is currently driving', () => {
        // The regression the design is built to avoid: a density slider
        // dragged mid-hold rewrites `invMass` from the body's own arrays, and
        // the hard drive law depends on the prescribed set surviving that
        // rewrite untouched.
        const particles = fakeParticles([1, 1, 1, 1]);
        Particles.prototype.setPrescribed.call(particles, [1]);

        particles.bodies[0].invMass = Float32Array.from([2, 2, 2, 2]);
        Particles.prototype.uploadMasses.call(particles);

        expect(Array.from(particles.invMass)).toEqual([2, 2, 2, 2]);
        expect(Array.from(particles.gpuInvMass)).toEqual([2, 0, 2, 2]);
    });
});
