/**
 * How a Gaussian rides the deformation.
 *
 * A mesh vertex needs two things from the channel and both are cheap: where it
 * went, and a normal. A Gaussian needs a third, and it is the expensive one.
 *
 * A splat is an ellipsoid, which is to say a covariance `S = R diag(s)^2 R^T`.
 * The field's local map is affine with gradient `F`, and an affine map carries a
 * covariance to `F S F^T` -- that part is one line. The cost is that the thing
 * on the other end does not want a covariance: it wants a rotation and three
 * axis lengths, the same shape the splat arrived in. So the transported
 * covariance has to be taken apart again, and taking a symmetric matrix apart
 * into axes is an eigenvalue problem.
 *
 * Written as `A = F R diag(s)`, so that `F S F^T = A A^T`, and what is wanted is
 * the `Q`, `L` with `A A^T = Q L Q^T`. Then the new rotation is `Q` and the new
 * axis lengths are `sqrt(L)`.
 *
 * Two honest limits, neither of which a picture would reveal:
 *
 *   - `F` is read once, at the centre. The field is trilinear, not affine, so
 *     `F` genuinely varies across a Gaussian's own width; at the resolutions
 *     this project uses a splat is a third of a cell across, so the far side of
 *     a large splat is carried by a gradient that is not quite its own. The
 *     error is second order in that width and it shows up as a slightly wrong
 *     shape, never as a wrong place.
 *   - `A A^T` squares the condition number, and captured splats are flat on
 *     purpose -- axis ratios of 100:1 are ordinary, 1e4 after squaring. Jacobi
 *     is chosen partly for this: it keeps relative accuracy on the small
 *     eigenvalues of a positive definite matrix, where a closed-form root of the
 *     characteristic polynomial does not. The short axis is sub-pixel either
 *     way; what matters is that the two long ones stay orthogonal to it.
 *
 * `covariance.wgsl` is the same maths on the GPU and is the copy that actually
 * runs. This one is the reference the unit tests pin the derivation against --
 * the conventions here (column-major, xyzw, `R diag(s)` and not `diag(s) R`) are
 * each a way to be silently wrong, and a picture of a wobbling loaf checks none
 * of them.
 */

/**
 * Jacobi sweeps. Each sweep zeroes all three off-diagonals once, and they grow
 * back smaller; convergence is quadratic once the matrix is nearly diagonal.
 *
 * Measured over 20000 random cases spanning gentle to violent gradients and
 * splats down to a 300:1 axis ratio, as the worst relative error of rebuilding
 * `A A^T` from the answer: 1 sweep 4e-1, 2 sweeps 6e-2, 3 sweeps 1.4e-6, 4
 * sweeps 1.6e-15. Three would already be lost in f32 rounding; four is taken
 * because the fourth sweep is about twenty flops and buys the whole margin.
 *
 * There is no early exit and that is deliberate: at four sweeps the test for
 * whether to stop costs more than finishing, and a branch that most lanes in a
 * wave take differently costs more still.
 */
const SWEEPS = 4;

/**
 * Where a Gaussian's axes go.
 *
 * @param {ArrayLike<number>} gradient - Deformation gradient, column-major 3x3.
 * @param {ArrayLike<number>} rotation - Rest orientation as a unit quaternion, xyzw.
 * @param {ArrayLike<number>} scale - Rest axis lengths (standard deviations).
 * @returns {{ rotation: number[], scale: number[] }} Deformed orientation and axis lengths.
 */
export function deformedGaussian(gradient, rotation, scale) {
    const basis = quaternionMatrix(rotation);

    // A = F R diag(s): column j of `R diag(s)` is the j-th axis of the rest
    // ellipsoid, so this is just the three axes carried through F one at a time.
    const a = new Array(9);
    for (let axis = 0; axis < 3; axis++) {
        for (let row = 0; row < 3; row++) {
            a[axis * 3 + row] = scale[axis] * (
                gradient[row] * basis[axis * 3] +
                gradient[3 + row] * basis[axis * 3 + 1] +
                gradient[6 + row] * basis[axis * 3 + 2]
            );
        }
    }

    const { orientation, eigenvalues } = diagonalize(symmetricProduct(a));
    return {
        rotation: orientation,
        // Negative eigenvalues are rounding around zero, not a shape; a singular
        // F -- a cell crushed flat -- lands here legitimately and should give an
        // axis length of zero rather than a NaN that poisons the whole splat.
        scale: eigenvalues.map(value => Math.sqrt(Math.max(value, 0)))
    };
}

/**
 * The rotation matrix of a unit quaternion, column-major: column `k` is where
 * basis vector `k` goes.
 *
 * @param {ArrayLike<number>} q - Unit quaternion, xyzw.
 * @returns {number[]} Column-major 3x3 rotation.
 */
function quaternionMatrix(q) {
    const [x, y, z, w] = q;
    return [
        1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
        2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
        2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)
    ];
}

/**
 * `a * transpose(a)`, which is symmetric by construction.
 *
 * @param {number[]} a - Column-major 3x3.
 * @returns {number[]} Column-major 3x3, symmetric.
 */
function symmetricProduct(a) {
    const out = new Array(9);
    for (let col = 0; col < 3; col++) {
        for (let row = 0; row < 3; row++) {
            out[col * 3 + row] =
                a[row] * a[col] + a[3 + row] * a[3 + col] + a[6 + row] * a[6 + col];
        }
    }
    return out;
}

/**
 * Cyclic Jacobi: repeatedly rotate in the plane of the largest remaining
 * off-diagonal entry until nothing is left off the diagonal.
 *
 * The accumulated rotation is carried as a quaternion rather than a matrix
 * because that is the form the caller wants back, and because the plane
 * rotations are exactly the quaternions with one imaginary part.
 *
 * @param {number[]} m - Symmetric column-major 3x3. Not modified.
 * @returns {{ orientation: number[], eigenvalues: number[] }} Its eigenvectors as
 *   a unit quaternion (xyzw), and the eigenvalues along the axes that quaternion
 *   names.
 */
function diagonalize(m) {
    const a = m.slice();
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
