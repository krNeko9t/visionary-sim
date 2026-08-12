/**
 * How a Gaussian rides the deformation.
 *
 * A mesh vertex needs two things from the channel and both are cheap: where it
 * went, and a normal. A Gaussian needs a third: what shape it is now.
 *
 * A splat is an ellipsoid, which is to say a covariance `S = R diag(s)^2 R^T`.
 * The field's local map is affine with gradient `F`, and an affine map carries a
 * covariance to `F S F^T`. That is the whole of this file, and it is deliberately
 * the whole of it: a covariance is what an ellipsoid *is*, so it is what this
 * channel hands out. Whoever draws it may want the same ellipsoid stated some
 * other way -- the engine here wants a rotation and three axis lengths -- and
 * restating it is that renderer's business, in `render/ellipsoid.js`.
 *
 * Written through `A = F R diag(s)`, so the answer is `A A^T`: column j of
 * `R diag(s)` is the j-th axis of the rest ellipsoid, so this is the three rest
 * axes carried through `F` one at a time and then summed as outer products.
 *
 * One honest limit, which a picture would not reveal: `F` is read once, at the
 * centre. The field is trilinear, not affine, so `F` genuinely varies across a
 * Gaussian's own width; at the resolutions this project uses a splat is a third
 * of a cell across, so the far side of a large splat is carried by a gradient
 * that is not quite its own. The error is second order in that width and it shows
 * up as a slightly wrong shape, never as a wrong place.
 *
 * `covariance.wgsl` is the same maths on the GPU and is the copy that actually
 * runs. This one is the reference the unit tests pin the derivation against --
 * the conventions here (column-major, xyzw, `R diag(s)` and not `diag(s) R`) are
 * each a way to be silently wrong, and a picture of a wobbling loaf checks none
 * of them.
 */

/**
 * The ellipsoid a Gaussian becomes under the field.
 *
 * @param {ArrayLike<number>} gradient - Deformation gradient, column-major 3x3.
 * @param {ArrayLike<number>} rotation - Rest orientation as a unit quaternion, xyzw.
 * @param {ArrayLike<number>} scale - Rest axis lengths (standard deviations).
 * @returns {number[]} The deformed covariance, column-major 3x3 and symmetric.
 */
export function deformedCovariance(gradient, rotation, scale) {
    const basis = quaternionMatrix(rotation);

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
    return symmetricProduct(a);
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
 * `a * transpose(a)`, which is symmetric by construction. Rows against rows and
 * not the other order: the covariance is the sum over the axes of their outer
 * products.
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
