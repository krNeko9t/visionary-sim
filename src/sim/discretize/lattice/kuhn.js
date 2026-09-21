import { CUBE_CORNERS } from '../../../deformation/corners.js';
import { mat3FromColumns, mat3Inverse } from '../mat3.js';

/**
 * Kuhn (Freudenthal) decomposition of a cube into 6 tetrahedra.
 *
 * Corner `c` of the unit cube sits at `(c & 1, (c >> 1) & 1, (c >> 2) & 1)`.
 * The six tetrahedra are the six paths from corner 0 to corner 7 that advance
 * one axis at a time -- one per permutation of (x, y, z).
 *
 * Two properties make this the right choice for a lattice:
 *
 * 1. It is *conforming*. Applying the same pattern to every cell splits each
 *    shared cube face along the same diagonal from both sides, so neighbouring
 *    cells share whole triangular faces. (The 5-tetrahedron decomposition only
 *    conforms if the pattern alternates with cell parity.)
 * 2. Every cell of the rest lattice is a congruent cube, so all cells share the
 *    *same six* rest shape matrices. There is no per-tetrahedron rest data to
 *    store or fetch at all -- normally the largest buffer in a FEM solver.
 */

/**
 * The six tetrahedra as corner indices, each ordered so that
 * `det[p1-p0, p2-p0, p3-p0]` is positive. Orientation matters: the sign of the
 * deformation gradient's determinant is what tells the solver inversion from
 * compression.
 */
export const KUHN_TETS = Object.freeze([
    [0, 1, 3, 7],
    [0, 5, 1, 7],
    [0, 3, 2, 7],
    [0, 2, 6, 7],
    [0, 4, 5, 7],
    [0, 6, 4, 7]
]);

/** Rest volume of one Kuhn tetrahedron as a fraction of the cell volume. */
export const KUHN_TET_VOLUME_FRACTION = 1 / 6;

/**
 * Every tetrahedron of a cell has the same rest volume, which is why the
 * elastic constraint can hand `elementCompliance` one number per body rather
 * than one per element.
 *
 * @param {number} h - Cell edge length, in metres.
 * @returns {number} Rest volume of a single tetrahedron, in m^3.
 */
export function tetRestVolume(h) {
    return KUHN_TET_VOLUME_FRACTION * h ** 3;
}

/**
 * Rest shape matrices `Dm = [p1-p0, p2-p0, p3-p0]` for a cell of edge length
 * `h`, one per tetrahedron, as column-major 3x3.
 *
 * @param {number} h - Cell edge length.
 * @returns {Float32Array[]} Six matrices.
 */
export function kuhnRestShapes(h = 1) {
    return KUHN_TETS.map(([c0, c1, c2, c3]) => {
        const p0 = CUBE_CORNERS[c0];
        const edge = (c) => [
            (CUBE_CORNERS[c][0] - p0[0]) * h,
            (CUBE_CORNERS[c][1] - p0[1]) * h,
            (CUBE_CORNERS[c][2] - p0[2]) * h
        ];
        return mat3FromColumns(edge(c1), edge(c2), edge(c3));
    });
}

/**
 * Inverse rest shape matrices. The deformation gradient of a tetrahedron is
 * `F = Ds * restShapeInverse`, where `Ds` holds the current edge vectors.
 *
 * @param {number} h - Cell edge length.
 * @returns {Float32Array[]} Six column-major 3x3 matrices.
 */
export function kuhnRestShapeInverses(h = 1) {
    return kuhnRestShapes(h).map(mat3Inverse);
}
