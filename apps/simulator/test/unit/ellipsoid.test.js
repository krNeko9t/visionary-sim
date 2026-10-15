import { describe, expect, it } from 'vitest';

import { ellipsoidAxes } from '../../src/render/ellipsoid.js';

/**
 * Taking an ellipsoid apart into the axes one renderer's buffer stores.
 *
 * Every assertion here is a reconstruction: build the covariance the answer
 * describes, and check it against the covariance that went in. That is
 * deliberate, and it is the only honest way to check this. The answer is a
 * rotation and three lengths, and those are not unique -- swap two axes, negate
 * an axis, turn the whole frame by a symmetry of the ellipsoid, and it is the
 * same ellipsoid described differently. Asserting on the quaternion would be
 * asserting on which of those the solver happened to land in.
 *
 * The covariances fed in are deliberately the ones this project actually
 * produces: `A A^T` for a flat captured splat under a violent gradient, which is
 * where the squared condition number costs the most precision.
 */

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * @param {ArrayLike<number>} a - Column-major 3x3.
 * @param {ArrayLike<number>} b - Column-major 3x3.
 * @returns {number[]} The product `a * b`.
 */
function multiply(a, b) {
    const out = new Array(9).fill(0);
    for (let col = 0; col < 3; col++) {
        for (let row = 0; row < 3; row++) {
            out[col * 3 + row] =
                a[row] * b[col * 3] + a[3 + row] * b[col * 3 + 1] + a[6 + row] * b[col * 3 + 2];
        }
    }
    return out;
}

/**
 * @param {ArrayLike<number>} m - Column-major 3x3.
 * @returns {number[]} Its transpose.
 */
function transpose(m) {
    return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

/**
 * The covariance of an ellipsoid given as an orientation and three axis lengths:
 * `R diag(s)^2 R^T`. Written through {@link multiply} rather than in closed form
 * so that it shares no arithmetic with the module under test.
 *
 * @param {ArrayLike<number>} rotation - Unit quaternion, xyzw.
 * @param {ArrayLike<number>} scale - Axis lengths.
 * @returns {number[]} Column-major 3x3, symmetric.
 */
function covariance(rotation, scale) {
    const [x, y, z, w] = rotation;
    const r = [
        1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
        2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
        2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)
    ];
    const scaled = r.map((value, at) => value * scale[Math.floor(at / 3)] ** 2);
    return multiply(scaled, transpose(r));
}

/**
 * @param {ArrayLike<number>} actual - Column-major 3x3.
 * @param {ArrayLike<number>} expected - Column-major 3x3.
 * @param {number} [tolerance] - Allowed error, relative to the largest entry.
 * @param {string} [what] - Named in the failure.
 */
function expectMatrix(actual, expected, tolerance = 1e-6, what = '') {
    const scale = Math.max(...Array.from(expected, Math.abs));
    for (let at = 0; at < 9; at++) {
        expect(Math.abs(actual[at] - expected[at]) / scale, `${what} entry ${at}`)
            .toBeLessThan(tolerance);
    }
}

/**
 * A deterministic stream, so a failure is the same failure next run.
 *
 * @param {number} seed - Any integer.
 * @returns {() => number} Values in [0, 1).
 */
function stream(seed) {
    let state = seed;
    return () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
}

/**
 * @param {() => number} next - A stream.
 * @returns {number[]} A unit quaternion, xyzw.
 */
function someRotation(next) {
    const q = [next() * 2 - 1, next() * 2 - 1, next() * 2 - 1, next() * 2 - 1];
    const length = Math.hypot(...q);
    return q.map(value => value / length);
}

/**
 * `A A^T` for `A = F R diag(s)` -- the shape of matrix this function is asked to
 * take apart in practice. Built here from scratch so this file does not depend on
 * the deformation channel to produce its inputs.
 *
 * @param {ArrayLike<number>} gradient - Column-major 3x3.
 * @param {ArrayLike<number>} rotation - Unit quaternion, xyzw.
 * @param {ArrayLike<number>} scale - Axis lengths.
 * @returns {number[]} Column-major 3x3, symmetric.
 */
function carried(gradient, rotation, scale) {
    return multiply(multiply(gradient, covariance(rotation, scale)), transpose(gradient));
}

describe('ellipsoidAxes', () => {
    it('leaves an ellipsoid alone when nothing deformed it', () => {
        // Identity has to be exactly a no-op, not nearly one: this runs every
        // frame, and axes that drifted would slowly dissolve the parts of a body
        // that are standing still.
        const rest = someRotation(stream(11));
        const scale = [0.02, 0.006, 0.0004];
        const moved = ellipsoidAxes(covariance(rest, scale));

        expectMatrix(covariance(moved.rotation, moved.scale), covariance(rest, scale), 1e-9);
    });

    it('reads the axes of a diagonal covariance straight off', () => {
        // The one case with an answer that can be written down, and the one that
        // catches a square root applied to the wrong quantity.
        const moved = ellipsoidAxes([0.0004, 0, 0, 0, 0.0036, 0, 0, 0, 0.0004]);
        const sorted = [...moved.scale].sort((a, b) => a - b);

        expect(sorted[0]).toBeCloseTo(0.02, 9);
        expect(sorted[1]).toBeCloseTo(0.02, 9);
        expect(sorted[2]).toBeCloseTo(0.06, 9);
    });

    it('describes the same ellipsoid it was given', () => {
        // The property the whole module exists for, over the inputs it really
        // sees: gradients from gentle to violent, and splats flat enough to be
        // surfaces -- which is where squaring the matrix costs the most precision.
        const next = stream(20260810);

        for (let trial = 0; trial < 2000; trial++) {
            const amplitude = [0.05, 0.4, 1.5][trial % 3];
            const gradient = IDENTITY.map(value => value + (next() * 2 - 1) * amplitude);
            const rotation = someRotation(next);
            const flat = trial % 4 === 0;
            const scale = [1, 0.3, flat ? 0.003 : 0.1].map(value => value * (0.5 + next()) * 0.02);

            const expected = carried(gradient, rotation, scale);
            const moved = ellipsoidAxes(expected);
            expectMatrix(
                covariance(moved.rotation, moved.scale), expected, 1e-9, `trial ${trial}`
            );
        }
    });

    it('hands back a unit quaternion', () => {
        // The caller writes this straight into a splat buffer that stores three
        // components and rebuilds the fourth from them, so a quaternion that is
        // not unit does not come back as a slightly wrong rotation -- it comes
        // back as a different one.
        const next = stream(7);

        for (let trial = 0; trial < 500; trial++) {
            const gradient = IDENTITY.map(value => value + (next() * 2 - 1) * 0.8);
            const moved = ellipsoidAxes(
                carried(gradient, someRotation(next), [0.02, 0.01, 0.0002])
            );
            expect(Math.hypot(...moved.rotation), `trial ${trial}`).toBeCloseTo(1, 9);
        }
    });

    it('flattens rather than fails when the ellipsoid is degenerate', () => {
        // A cell crushed flat is a legitimate thing for the solver to produce
        // under a hard enough grab. The splat should lose an axis, not become a
        // NaN that survives into the buffer and takes the frame with it.
        const flattening = [1, 0, 0, 0, 0, 0, 0, 0, 1];
        const moved = ellipsoidAxes(
            carried(flattening, someRotation(stream(3)), [0.02, 0.01, 0.005])
        );
        const sorted = [...moved.scale].sort((a, b) => a - b);

        expect(moved.scale.every(Number.isFinite)).toBe(true);
        expect(moved.rotation.every(Number.isFinite)).toBe(true);
        expect(sorted[0]).toBeLessThan(1e-9);
        expect(sorted[2]).toBeGreaterThan(1e-3);
    });
});
