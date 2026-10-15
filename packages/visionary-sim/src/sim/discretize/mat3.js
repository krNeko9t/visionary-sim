/**
 * Minimal column-major 3x3 matrix helpers.
 *
 * Column-major matches WGSL's `mat3x3<f32>`, so the same index arithmetic reads
 * correctly on both sides: element (row, col) lives at `m[col * 3 + row]`.
 *
 * This exists instead of `pc.Mat3` because everything under `sim/discretize/` must
 * stay importable by plain node for the unit tests.
 */

/**
 * @param {number[]} c0 - First column.
 * @param {number[]} c1 - Second column.
 * @param {number[]} c2 - Third column.
 * @returns {Float32Array} Column-major 3x3 matrix.
 */
export function mat3FromColumns(c0, c1, c2) {
    return new Float32Array([c0[0], c0[1], c0[2], c1[0], c1[1], c1[2], c2[0], c2[1], c2[2]]);
}

/**
 * @param {ArrayLike<number>} m - Column-major 3x3 matrix.
 * @returns {number} The determinant.
 */
export function mat3Determinant(m) {
    return (
        m[0] * (m[4] * m[8] - m[7] * m[5]) -
        m[3] * (m[1] * m[8] - m[7] * m[2]) +
        m[6] * (m[1] * m[5] - m[4] * m[2])
    );
}

/**
 * @param {ArrayLike<number>} m - Column-major 3x3 matrix.
 * @returns {Float32Array} The inverse.
 * @throws {Error} If the matrix is singular.
 */
export function mat3Inverse(m) {
    const det = mat3Determinant(m);
    if (Math.abs(det) < 1e-20) {
        throw new Error('mat3Inverse: singular matrix');
    }
    const s = 1 / det;
    return new Float32Array([
        (m[4] * m[8] - m[7] * m[5]) * s,
        (m[7] * m[2] - m[1] * m[8]) * s,
        (m[1] * m[5] - m[4] * m[2]) * s,
        (m[6] * m[5] - m[3] * m[8]) * s,
        (m[0] * m[8] - m[6] * m[2]) * s,
        (m[3] * m[2] - m[0] * m[5]) * s,
        (m[3] * m[7] - m[6] * m[4]) * s,
        (m[6] * m[1] - m[0] * m[7]) * s,
        (m[0] * m[4] - m[3] * m[1]) * s
    ]);
}

/**
 * The rotation matrix of a unit quaternion.
 *
 * Column-major means column `k` is `m[k * 3 .. k * 3 + 2]`, and column `k` is
 * where the k-th basis vector goes. That is worth naming, because it is what
 * makes `dot(column_k, v)` the k-th component of `transpose(R) * v` -- turning a
 * world vector into the rotated frame's own coordinates without building a
 * second matrix to transpose.
 *
 * @param {ArrayLike<number>} q - Unit quaternion as xyzw.
 * @param {number} [at] - Index of the quaternion's first component.
 * @param {Float32Array} [out] - Optional destination of length 9.
 * @returns {Float32Array} Column-major 3x3 rotation matrix.
 */
export function mat3FromQuat(q, at = 0, out = new Float32Array(9)) {
    const x = q[at], y = q[at + 1], z = q[at + 2], w = q[at + 3];

    out[0] = 1 - 2 * (y * y + z * z);
    out[1] = 2 * (x * y + z * w);
    out[2] = 2 * (x * z - y * w);

    out[3] = 2 * (x * y - z * w);
    out[4] = 1 - 2 * (x * x + z * z);
    out[5] = 2 * (y * z + x * w);

    out[6] = 2 * (x * z + y * w);
    out[7] = 2 * (y * z - x * w);
    out[8] = 1 - 2 * (x * x + y * y);

    return out;
}

/**
 * @param {ArrayLike<number>} a - Left column-major 3x3 matrix.
 * @param {ArrayLike<number>} b - Right column-major 3x3 matrix.
 * @returns {Float32Array} The product `a * b`.
 */
export function mat3Multiply(a, b) {
    const out = new Float32Array(9);
    for (let col = 0; col < 3; col++) {
        for (let row = 0; row < 3; row++) {
            out[col * 3 + row] =
                a[row] * b[col * 3] +
                a[3 + row] * b[col * 3 + 1] +
                a[6 + row] * b[col * 3 + 2];
        }
    }
    return out;
}
