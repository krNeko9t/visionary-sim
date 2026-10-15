import { describe, expect, it } from 'vitest';

import { deformedCovariance } from '../../src/deformation/covariance.js';

/**
 * Carrying a Gaussian through the deformation.
 *
 * The property under test is one line of algebra -- an affine map with gradient
 * `F` carries a covariance `S` to `F S F^T` -- and the whole reason to test it is
 * that the conventions around that line are each a way to be silently wrong:
 * column-major or row-major, xyzw or wxyz, `R diag(s)` or `diag(s) R`, `A A^T` or
 * `A^T A`. A picture of a wobbling loaf checks none of them.
 *
 * The answer is a covariance and a covariance is unique, so every assertion here
 * compares matrices directly. Taking that covariance apart into axes is
 * `render/ellipsoid.js`, and `ellipsoid.test.js` covers it separately.
 */

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const NO_ROTATION = [0, 0, 0, 1];

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

describe('deformedCovariance', () => {
    it('leaves a splat alone when nothing deformed it', () => {
        // F = I has to be exactly a no-op, not nearly one: this runs every
        // frame, and a transport that drifted would slowly dissolve the parts of
        // a body that are standing still.
        const rotation = [0.3, -0.5, 0.2, 0.7];
        const length = Math.hypot(...rotation);
        const rest = rotation.map(value => value / length);
        const scale = [0.02, 0.006, 0.0004];

        expectMatrix(
            deformedCovariance(IDENTITY, rest, scale), covariance(rest, scale), 1e-9
        );
    });

    it('stretches an axis-aligned splat along the axis that stretched', () => {
        // The one case with an answer that can be written down: an unrotated
        // splat under a diagonal F stays axis-aligned and scales each axis by its
        // own factor, so the covariance is diagonal with those squares on it.
        // Worth having as a case where a transposed F is caught by reading the
        // numbers, not only by the reconstruction below.
        const moved = deformedCovariance(
            [2, 0, 0, 0, 3, 0, 0, 0, 0.5], NO_ROTATION, [0.01, 0.02, 0.04]
        );

        expectMatrix(
            moved,
            [0.02 ** 2, 0, 0, 0, 0.06 ** 2, 0, 0, 0, 0.02 ** 2],
            1e-9
        );
    });

    it('carries the covariance the way an affine map does', () => {
        // The property the whole module exists for. Over gradients from gentle to
        // violent, and over splats flat enough to be surfaces -- which is what a
        // capture is mostly made of.
        const next = stream(20260810);

        for (let trial = 0; trial < 2000; trial++) {
            const amplitude = [0.05, 0.4, 1.5][trial % 3];
            const gradient = IDENTITY.map(value => value + (next() * 2 - 1) * amplitude);
            const rotation = someRotation(next);
            const flat = trial % 4 === 0;
            const scale = [1, 0.3, flat ? 0.003 : 0.1].map(value => value * (0.5 + next()) * 0.02);

            expectMatrix(
                deformedCovariance(gradient, rotation, scale),
                multiply(multiply(gradient, covariance(rotation, scale)), transpose(gradient)),
                1e-9,
                `trial ${trial}`
            );
        }
    });

    it('stays symmetric', () => {
        // The consumer diagonalises this as a symmetric matrix and reads only one
        // triangle of it in places. An asymmetric result would not throw; it would
        // quietly give wrong axes.
        const next = stream(99);

        for (let trial = 0; trial < 500; trial++) {
            const gradient = IDENTITY.map(value => value + (next() * 2 - 1) * 1.2);
            const m = deformedCovariance(gradient, someRotation(next), [0.02, 0.01, 0.0002]);
            const scale = Math.max(...m.map(Math.abs));

            for (const [a, b] of [[1, 3], [2, 6], [5, 7]]) {
                expect(Math.abs(m[a] - m[b]) / scale, `trial ${trial}`).toBeLessThan(1e-12);
            }
        }
    });
});
