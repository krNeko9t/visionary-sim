import { CUBE_CORNERS } from '../../deformation/corners.js';

/**
 * Turns an occupancy grid into the simulation's degrees of freedom.
 *
 * Nodes are the corners of every cell, kept as a full dense grid even where no
 * material touches them: dense indexing (`i + nnx * (j + nny * k)`) is what lets
 * the GPU derive the eight corner indices of a cell from arithmetic alone, with
 * no connectivity buffer. Unused nodes get zero inverse mass and are inactive.
 *
 * @typedef {object} Lattice
 * @property {number[]} origin - World position of the min corner of cell (0,0,0).
 * @property {number} h - Cell edge length.
 * @property {number[]} cellDims - Cell counts along each axis.
 * @property {number[]} nodeDims - Node counts along each axis, `cellDims + 1`.
 * @property {number} nodeCount - Total nodes, including inactive ones.
 * @property {Float32Array} restPositions - Node rest positions, 3 floats per node.
 * @property {Float32Array} invMass - Per-node inverse mass, 0 where inactive.
 * @property {Uint32Array} cells - Linear indices of occupied cells, grouped by colour.
 * @property {{ start: number, count: number }[]} colorRanges - Range of `cells` per colour.
 * @property {number} mass - Total mass in kilograms.
 * @property {number} volume - Total occupied volume in cubic metres.
 */

/** Number of parallel colour groups; see {@link cellColor}. */
export const COLOR_COUNT = 8;

/**
 * Colour of a cell for parallel Gauss-Seidel.
 *
 * Two cells share a node only if their indices differ by at most one on every
 * axis. Cells of the same colour agree in parity on every axis, so they either
 * are the same cell or differ by at least two somewhere -- they can never share
 * a node, and a whole colour can be solved in parallel without atomics.
 *
 * This is why the lattice is worth its approximation error: on an unstructured
 * tetrahedral mesh the same guarantee needs a runtime graph colouring pass.
 *
 * @param {number} i - Cell index along x.
 * @param {number} j - Cell index along y.
 * @param {number} k - Cell index along z.
 * @returns {number} Colour in [0, 8).
 */
export function cellColor(i, j, k) {
    return (i & 1) | ((j & 1) << 1) | ((k & 1) << 2);
}

/**
 * @param {number[]} nodeDims - Node counts along each axis.
 * @param {number} i - Node index along x.
 * @param {number} j - Node index along y.
 * @param {number} k - Node index along z.
 * @returns {number} Linear node index.
 */
export function nodeIndex(nodeDims, i, j, k) {
    return i + nodeDims[0] * (j + nodeDims[1] * k);
}

/**
 * Unpacks a linear cell index back into grid coordinates.
 *
 * `cells` stores linear indices, so everything that walks that array needs this
 * -- the debug renderer, the tests, and `cellCoords` in `sim/constraints/wgsl/cells.wgsl`.
 * The WGSL copy is unavoidable, being a different language; `lattice.test.js`
 * pins the two against a round trip so they cannot drift apart silently.
 *
 * @param {number[]} cellDims - Cell counts along each axis.
 * @param {number} linear - Linear cell index.
 * @param {number[]} [out] - Optional destination of length 3.
 * @returns {number[]} Cell coordinates.
 */
export function cellCoords(cellDims, linear, out = [0, 0, 0]) {
    out[0] = linear % cellDims[0];
    out[1] = Math.floor(linear / cellDims[0]) % cellDims[1];
    out[2] = Math.floor(linear / (cellDims[0] * cellDims[1]));
    return out;
}

/**
 * @param {number[]} cellDims - Cell counts along each axis.
 * @param {number} i - Cell index along x.
 * @param {number} j - Cell index along y.
 * @param {number} k - Cell index along z.
 * @returns {number} Linear cell index.
 */
export function cellIndex(cellDims, i, j, k) {
    return i + cellDims[0] * (j + cellDims[1] * k);
}

/**
 * The eight corner node indices of a cell, in {@link CUBE_CORNERS} order.
 *
 * @param {number[]} nodeDims - Node counts along each axis.
 * @param {number} i - Cell index along x.
 * @param {number} j - Cell index along y.
 * @param {number} k - Cell index along z.
 * @param {Uint32Array|number[]} [out] - Optional destination of length 8.
 * @returns {Uint32Array|number[]} The node indices.
 */
export function cellNodeIndices(nodeDims, i, j, k, out = new Uint32Array(8)) {
    for (let c = 0; c < 8; c++) {
        const [dx, dy, dz] = CUBE_CORNERS[c];
        out[c] = nodeIndex(nodeDims, i + dx, j + dy, k + dz);
    }
    return out;
}

/**
 * The nodes on the boundary of the occupied region.
 *
 * A node is on the boundary when some of the eight cells around it hold
 * material and some do not; outside the grid counts as not. Nodes with all
 * eight occupied are buried and can only be reached through the material, and
 * nodes with none are inactive.
 *
 * This is a fact about the discretisation, not about anything that uses it,
 * which is why it lives here. What it is for is contact: the boundary is where
 * a body ends, so it is the only part of one that another can touch.
 *
 * How much work that saves is a surface against a volume, so it improves as the
 * lattice gets finer and is unremarkable now: at the twelve cells these bodies
 * are cut at, 2541 nodes of the 4127 that have any mass. Against the full node
 * array it is 2541 of 14104, because the lattice is dense and mostly empty.
 *
 * @param {Lattice} lattice - The lattice.
 * @returns {Uint32Array} Boundary node indices, ascending.
 */
export function surfaceNodes({ cellDims, nodeDims, cells }) {
    const occupied = new Uint8Array(cellDims[0] * cellDims[1] * cellDims[2]);
    for (const cell of cells) {
        occupied[cell] = 1;
    }

    /** @type {number[]} */
    const found = [];
    for (let k = 0; k < nodeDims[2]; k++) {
        for (let j = 0; j < nodeDims[1]; j++) {
            for (let i = 0; i < nodeDims[0]; i++) {
                // The eight cells incident on node (i, j, k) are those whose
                // min corner is one step back from it on each axis.
                let filled = 0;
                for (let c = 0; c < 8; c++) {
                    const [dx, dy, dz] = CUBE_CORNERS[c];
                    const ci = i + dx - 1;
                    const cj = j + dy - 1;
                    const ck = k + dz - 1;
                    const outside = ci < 0 || cj < 0 || ck < 0 ||
                        ci >= cellDims[0] || cj >= cellDims[1] || ck >= cellDims[2];
                    filled += outside ? 0 : occupied[cellIndex(cellDims, ci, cj, ck)];
                }
                if (filled > 0 && filled < 8) {
                    found.push(nodeIndex(nodeDims, i, j, k));
                }
            }
        }
    }
    return Uint32Array.from(found);
}

/**
 * @param {import('./voxelize.js').OccupancyGrid} grid - Source occupancy.
 * @param {object} options - Build options.
 * @param {number} options.density - Material density in kg/m^3.
 * @returns {Lattice} The simulation lattice.
 */
export function buildLattice(grid, { density }) {
    const { dims: cellDims, origin, h, occupancy } = grid;
    const nodeDims = [cellDims[0] + 1, cellDims[1] + 1, cellDims[2] + 1];
    const nodeCount = nodeDims[0] * nodeDims[1] * nodeDims[2];

    const restPositions = new Float32Array(nodeCount * 3);
    for (let k = 0; k < nodeDims[2]; k++) {
        for (let j = 0; j < nodeDims[1]; j++) {
            for (let i = 0; i < nodeDims[0]; i++) {
                const base = nodeIndex(nodeDims, i, j, k) * 3;
                restPositions[base] = origin[0] + i * h;
                restPositions[base + 1] = origin[1] + j * h;
                restPositions[base + 2] = origin[2] + k * h;
            }
        }
    }

    // A cell's mass is spread evenly over its eight corners, which is the
    // lumped-mass equivalent of summing rho * V / 4 over its six tetrahedra.
    const cellMass = density * h * h * h;
    const cornerMass = cellMass / 8;
    const mass = new Float32Array(nodeCount);

    /** @type {number[][]} */
    const byColor = Array.from({ length: COLOR_COUNT }, () => []);
    const corners = new Uint32Array(8);
    let occupiedCount = 0;

    for (let k = 0; k < cellDims[2]; k++) {
        for (let j = 0; j < cellDims[1]; j++) {
            for (let i = 0; i < cellDims[0]; i++) {
                const cell = cellIndex(cellDims, i, j, k);
                if (occupancy[cell] === 0) {
                    continue;
                }
                occupiedCount++;
                byColor[cellColor(i, j, k)].push(cell);

                cellNodeIndices(nodeDims, i, j, k, corners);
                for (let c = 0; c < 8; c++) {
                    mass[corners[c]] += cornerMass;
                }
            }
        }
    }

    const cells = new Uint32Array(occupiedCount);
    const colorRanges = [];
    let start = 0;
    for (const group of byColor) {
        cells.set(group, start);
        colorRanges.push({ start, count: group.length });
        start += group.length;
    }

    const invMass = new Float32Array(nodeCount);
    for (let n = 0; n < nodeCount; n++) {
        invMass[n] = mass[n] > 0 ? 1 / mass[n] : 0;
    }

    return {
        origin: [...origin],
        h,
        cellDims: [...cellDims],
        nodeDims,
        nodeCount,
        restPositions,
        invMass,
        cells,
        colorRanges,
        mass: occupiedCount * cellMass,
        volume: occupiedCount * h * h * h
    };
}
