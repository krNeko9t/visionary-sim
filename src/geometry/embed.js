import { CUBE_CORNERS } from './kuhn.js';

/**
 * Trilinear embedding of arbitrary rest points in the lattice.
 *
 * This is the whole deformation field, and the reason the lattice was chosen
 * over a surface-conforming tetrahedral mesh: locating a point costs a divide
 * and a floor, the eight weights are a product of three lerps, and the
 * deformation gradient falls out of the same shape functions for free. A tet
 * mesh needs a spatial hash and per-point storage to answer the same question,
 * and cannot answer it at all for a Gaussian splat cloud, which has no surface.
 *
 * The WGSL in `sim/wgsl/field.wgsl` is the same maths on the GPU. These
 * functions are the CPU reference the unit tests pin that behaviour against.
 *
 * @typedef {object} LatticeSpace
 * @property {number[]} origin - World position of the min corner of cell (0,0,0).
 * @property {number} h - Cell edge length.
 * @property {number[]} cellDims - Cell counts along each axis.
 */

/**
 * Finds the cell containing a rest point and its local coordinates within it.
 *
 * Points outside the grid are clamped to the outermost cell, which lets the
 * local coordinates leave [0, 1] and extrapolate the field. That is the right
 * failure mode: snapping them into range would collapse geometry onto the
 * lattice boundary instead of merely distorting it.
 *
 * @param {LatticeSpace} space - Lattice layout.
 * @param {number} x - Rest position x.
 * @param {number} y - Rest position y.
 * @param {number} z - Rest position z.
 * @returns {{ cell: number[], local: number[] }} Cell indices and local coordinates.
 */
export function locate(space, x, y, z) {
    const { origin, h, cellDims } = space;
    const cell = [0, 0, 0];
    const local = [0, 0, 0];
    const p = [x, y, z];

    for (let axis = 0; axis < 3; axis++) {
        const grid = (p[axis] - origin[axis]) / h;
        const index = Math.min(Math.max(Math.floor(grid), 0), cellDims[axis] - 1);
        cell[axis] = index;
        local[axis] = grid - index;
    }
    return { cell, local };
}

/**
 * Trilinear weights of the eight cell corners, in {@link CUBE_CORNERS} order.
 *
 * @param {number[]} local - Local coordinates within the cell.
 * @param {Float32Array} [out] - Optional destination of length 8.
 * @returns {Float32Array} The weights, summing to 1.
 */
export function trilinearWeights(local, out = new Float32Array(8)) {
    const [u, v, w] = local;
    for (let c = 0; c < 8; c++) {
        const [cx, cy, cz] = CUBE_CORNERS[c];
        out[c] = (cx ? u : 1 - u) * (cy ? v : 1 - v) * (cz ? w : 1 - w);
    }
    return out;
}

/**
 * World-space gradients of the trilinear weights, 3 floats per corner.
 *
 * The deformation gradient of the field at this point is
 * `F = sum_c nodePosition_c (x) gradient_c`, which is exact for the trilinear
 * map and needs no extra state.
 *
 * @param {number[]} local - Local coordinates within the cell.
 * @param {number} h - Cell edge length.
 * @param {Float32Array} [out] - Optional destination of length 24.
 * @returns {Float32Array} The gradients.
 */
export function trilinearGradients(local, h, out = new Float32Array(24)) {
    const [u, v, w] = local;
    const inv = 1 / h;
    for (let c = 0; c < 8; c++) {
        const [cx, cy, cz] = CUBE_CORNERS[c];
        const fu = cx ? u : 1 - u;
        const fv = cy ? v : 1 - v;
        const fw = cz ? w : 1 - w;
        out[c * 3] = (cx ? 1 : -1) * fv * fw * inv;
        out[c * 3 + 1] = (cy ? 1 : -1) * fu * fw * inv;
        out[c * 3 + 2] = (cz ? 1 : -1) * fu * fv * inv;
    }
    return out;
}

/**
 * Evaluates the deformed position of an embedded point.
 *
 * @param {Float32Array} nodePositions - Node positions, 3 floats per node.
 * @param {ArrayLike<number>} nodeIndices - The eight corner node indices.
 * @param {Float32Array} weights - Trilinear weights from {@link trilinearWeights}.
 * @param {number[]} [out] - Optional destination of length 3.
 * @returns {number[]} The deformed position.
 */
export function evaluatePosition(nodePositions, nodeIndices, weights, out = [0, 0, 0]) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    for (let c = 0; c < 8; c++) {
        const base = nodeIndices[c] * 3;
        const weight = weights[c];
        out[0] += nodePositions[base] * weight;
        out[1] += nodePositions[base + 1] * weight;
        out[2] += nodePositions[base + 2] * weight;
    }
    return out;
}

/**
 * Evaluates the deformation gradient of the field at an embedded point.
 *
 * @param {Float32Array} nodePositions - Node positions, 3 floats per node.
 * @param {ArrayLike<number>} nodeIndices - The eight corner node indices.
 * @param {Float32Array} gradients - Weight gradients from {@link trilinearGradients}.
 * @param {Float32Array} [out] - Optional column-major 3x3 destination.
 * @returns {Float32Array} The deformation gradient.
 */
export function evaluateDeformationGradient(nodePositions, nodeIndices, gradients, out = new Float32Array(9)) {
    out.fill(0);
    for (let c = 0; c < 8; c++) {
        const base = nodeIndices[c] * 3;
        const px = nodePositions[base];
        const py = nodePositions[base + 1];
        const pz = nodePositions[base + 2];
        for (let col = 0; col < 3; col++) {
            const g = gradients[c * 3 + col];
            out[col * 3] += px * g;
            out[col * 3 + 1] += py * g;
            out[col * 3 + 2] += pz * g;
        }
    }
    return out;
}
