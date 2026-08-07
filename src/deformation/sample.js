import { CUBE_CORNERS } from './corners.js';

/**
 * The channel between the simulation side and the render side.
 *
 * The simulation moves a small number of nodes. Any rest point -- a mesh
 * vertex today, a Gaussian centre at M6 -- asks this module where it ended up
 * and how the space around it was stretched. Nothing else crosses.
 *
 * Two answers, from one sampling:
 *   position  x(p) = sum_c N_c(u) x_c
 *   gradient  F(p) = sum_c x_c (x) grad N_c(u)
 *
 * The gradient is what lets the render side do more than move points: a mesh
 * turns it into a normal, a Gaussian turns it into a rotated covariance. It
 * falls out of the same shape functions for free, which is the reason this
 * channel can serve both.
 *
 * This module depends on nothing. That is deliberate and enforced by
 * `test/unit/architecture.test.js`: a channel that reached into either side
 * would stop being a channel.
 *
 * `sample.wgsl` is the same maths on the GPU, and `bind.js` is how a material
 * gets at it; these functions are the CPU reference the unit tests pin that
 * behaviour against.
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
