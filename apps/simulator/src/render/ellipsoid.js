/**
 * Stating an ellipsoid the way a renderer wants to hear it.
 *
 * The deformation channel hands out a covariance, because that is what an
 * ellipsoid is. This engine's splat buffer stores a rotation and three axis
 * lengths instead, so the covariance has to be taken apart into axes -- which is
 * an eigenvalue problem, and by a good margin the most expensive arithmetic on
 * the whole splat path.
 *
 * It lives here, and that placement is the point: the cost is not a property of
 * deforming a Gaussian, it is the price of one renderer's storage format. A
 * backend that took a covariance directly would delete this file and nothing
 * else. Nothing above `render/` should have to know the format exists.
 *
 * One honest limit: `A A^T` squares the condition number, and captured splats are
 * flat on purpose -- axis ratios of 100:1 are ordinary, 1e4 after squaring.
 * Jacobi is chosen partly for this. It keeps relative accuracy on the small
 * eigenvalues of a positive definite matrix, where a closed-form root of the
 * characteristic polynomial does not. The short axis is sub-pixel either way;
 * what matters is that the two long ones stay orthogonal to it.
 *
 * `ellipsoid.wgsl` is the same maths on the GPU and is the copy that actually
 * runs. This one is the reference the unit tests pin.
 */

/**
 * Jacobi sweeps. Each sweep zeroes all three off-diagonals once, and they grow
 * back smaller; convergence is quadratic once the matrix is nearly diagonal.
 *
 * Measured over 20000 random cases spanning gentle to violent gradients and
 * splats down to a 300:1 axis ratio, as the worst relative error of rebuilding
 * the covariance from the answer: 1 sweep 4e-1, 2 sweeps 6e-2, 3 sweeps 1.4e-6,
 * 4 sweeps 1.6e-15. Three would already be lost in f32 rounding; four is taken
 * because the fourth sweep is about twenty flops and buys the whole margin.
 *
 * There is no early exit and that is deliberate: at four sweeps the test for
 * whether to stop costs more than finishing, and a branch that most lanes in a
 * wave take differently costs more still.
 */
const SWEEPS = 4;

/**
 * The axes of an ellipsoid given as a covariance.
 *
 * @param {ArrayLike<number>} covariance - Symmetric column-major 3x3.
 * @returns {{ rotation: number[], scale: number[] }} Its orientation as a unit
 *   quaternion (xyzw) and the axis lengths along the axes that quaternion names.
 */
export function ellipsoidAxes(covariance) {
    const { orientation, eigenvalues } = diagonalize(covariance);
    return {
        rotation: orientation,
        // Negative eigenvalues are rounding around zero, not a shape. An
        // ellipsoid crushed flat is a legitimate thing to be handed, and should
        // give an axis length of zero rather than a NaN that poisons the splat.
        scale: eigenvalues.map(value => Math.sqrt(Math.max(value, 0)))
    };
}

/**
 * Cyclic Jacobi: repeatedly rotate in the plane of an off-diagonal entry to zero
 * it, until nothing is left off the diagonal.
 *
 * The accumulated rotation is carried as a quaternion rather than a matrix
 * because that is the form the caller wants back, and because the plane
 * rotations are exactly the quaternions with one imaginary part.
 *
 * @param {ArrayLike<number>} m - Symmetric column-major 3x3. Not modified.
 * @returns {{ orientation: number[], eigenvalues: number[] }} Its eigenvectors as
 *   a unit quaternion (xyzw), and the eigenvalues along the axes that quaternion
 *   names.
 */
function diagonalize(m) {
    const a = Array.from(m);
    let q = [0, 0, 0, 1];
    const at = (row, col) => a[col * 3 + row];
    const set = (row, col, value) => {
        a[col * 3 + row] = value;
        a[row * 3 + col] = value;
    };

    for (let sweep = 0; sweep < SWEEPS; sweep++) {
        // (p, r, other) cyclic, so the plane's normal is always +other and the
        // quaternion never needs a parity correction. The three cyclic triples
        // still cover all three off-diagonal entries.
        for (let p = 0; p < 3; p++) {
            const r = (p + 1) % 3;
            const other = (p + 2) % 3;
            const apr = at(p, r);
            if (apr === 0) {
                continue;
            }

            // Rotate by the angle that zeroes a[p][r]; of the two such angles
            // take the smaller, which is what keeps the accumulated rotation
            // near the identity and the sweeps convergent.
            const app = at(p, p);
            const arr = at(r, r);
            const theta = (arr - app) / (2 * apr);
            const sign = theta >= 0 ? 1 : -1;
            const tangent = sign / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
            const cos = 1 / Math.sqrt(tangent * tangent + 1);
            const sin = tangent * cos;

            const apo = at(p, other);
            const aro = at(r, other);
            set(p, p, app - tangent * apr);
            set(r, r, arr + tangent * apr);
            set(p, r, 0);
            set(p, other, cos * apo - sin * aro);
            set(r, other, sin * apo + cos * aro);

            // The plane rotation as a quaternion, via the half-angle tangent
            // `sin / (1 + cos)`. Taken this way rather than from
            // `sqrt((1 - cos) / 2)`, which is the same number but computed
            // through a subtraction that cancels for exactly the small angles
            // the late sweeps are made of -- that form alone costs seven digits
            // of the answer.
            const half = -(sin / (1 + cos));
            const j = [0, 0, 0, 1];
            j[other] = half;
            q = normalized(multiplyQuaternions(q, j));
        }
    }
    return { orientation: q, eigenvalues: [at(0, 0), at(1, 1), at(2, 2)] };
}

/**
 * @param {number[]} a - Left quaternion, xyzw.
 * @param {number[]} b - Right quaternion, xyzw. Need not be unit.
 * @returns {number[]} The product, whose matrix is `matrix(a) * matrix(b)`.
 */
function multiplyQuaternions(a, b) {
    return [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
    ];
}

/**
 * @param {number[]} q - Any non-zero quaternion.
 * @returns {number[]} The same rotation, unit length.
 */
function normalized(q) {
    const length = Math.hypot(q[0], q[1], q[2], q[3]);
    return q.map(value => value / length);
}
