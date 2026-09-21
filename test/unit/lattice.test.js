import { describe, expect, it } from 'vitest';

import { COLOR_COUNT, buildLattice, cellColor, cellCoords, cellIndex, cellNodeIndices, nodeIndex, surfaceNodes } from '../../src/sim/discretize/lattice/lattice.js';
import { sphere } from '../../src/assets/shapes.js';
import { voxelizeSdf } from '../../src/sim/discretize/lattice/voxelize.js';

const DENSITY = 1000;

/**
 * @param {number} resolution - Cells along the longest axis.
 * @returns {import('../../src/sim/discretize/lattice/lattice.js').Lattice} A sphere lattice.
 */
function sphereLattice(resolution = 12) {
    return buildLattice(voxelizeSdf(sphere({ radius: 0.1 }), { resolution }), { density: DENSITY });
}

describe('lattice', () => {
    it('never puts two cells that share a node in the same colour group', () => {
        // This is the correctness foundation of the GPU solver: a whole colour
        // is dispatched at once with no atomics, so two cells of one colour
        // touching the same node would race and silently corrupt the state.
        const lattice = sphereLattice();
        const { cells, colorRanges, cellDims, nodeDims } = lattice;
        const corners = new Uint32Array(8);

        expect(colorRanges).toHaveLength(COLOR_COUNT);

        for (const { start, count } of colorRanges) {
            /** @type {Set<number>} */
            const claimed = new Set();
            for (let n = 0; n < count; n++) {
                const [i, j, k] = cellCoords(cellDims, cells[start + n]);
                cellNodeIndices(nodeDims, i, j, k, corners);
                for (const node of corners) {
                    expect(claimed.has(node)).toBe(false);
                    claimed.add(node);
                }
            }
        }
    });

    it('round-trips a cell index through its coordinates', () => {
        // `cellCoords` also exists in WGSL, in sim/constraints/wgsl/cells.wgsl, where the
        // solver unpacks the very same `cells` array. The two cannot share code
        // across the language boundary, so this pins the JS side to the exact
        // packing `buildLattice` writes; if the WGSL copy ever drifts, the
        // solver reads the wrong nodes and the bodies visibly tear.
        const cellDims = [7, 5, 3];
        for (let k = 0; k < cellDims[2]; k++) {
            for (let j = 0; j < cellDims[1]; j++) {
                for (let i = 0; i < cellDims[0]; i++) {
                    expect(cellCoords(cellDims, cellIndex(cellDims, i, j, k))).toEqual([i, j, k]);
                }
            }
        }
    });

    it('groups cells by the parity of their indices', () => {
        expect(cellColor(0, 0, 0)).toBe(0);
        expect(cellColor(1, 0, 0)).toBe(1);
        expect(cellColor(0, 1, 0)).toBe(2);
        expect(cellColor(0, 0, 1)).toBe(4);
        expect(cellColor(7, 5, 3)).toBe(7);
        // Cells two apart on every axis share no node and share a colour.
        expect(cellColor(4, 6, 2)).toBe(cellColor(6, 8, 4));
    });

    it('accounts for every occupied cell exactly once across the colour groups', () => {
        const lattice = sphereLattice();
        const total = lattice.colorRanges.reduce((sum, r) => sum + r.count, 0);
        expect(total).toBe(lattice.cells.length);
        expect(new Set(lattice.cells).size).toBe(lattice.cells.length);
    });

    it('conserves mass when lumping cell mass onto nodes', () => {
        const lattice = sphereLattice();
        let lumped = 0;
        for (const inv of lattice.invMass) {
            if (inv > 0) {
                lumped += 1 / inv;
            }
        }
        expect(lumped).toBeCloseTo(lattice.mass, 6);
        expect(lattice.mass).toBeCloseTo(DENSITY * lattice.volume, 6);
    });

    it('places nodes on the grid corners', () => {
        const lattice = sphereLattice(8);
        const { origin, h, nodeDims, restPositions } = lattice;

        for (const [i, j, k] of [[0, 0, 0], [1, 2, 3], [nodeDims[0] - 1, nodeDims[1] - 1, nodeDims[2] - 1]]) {
            const base = nodeIndex(nodeDims, i, j, k) * 3;
            expect(restPositions[base]).toBeCloseTo(origin[0] + i * h, 6);
            expect(restPositions[base + 1]).toBeCloseTo(origin[1] + j * h, 6);
            expect(restPositions[base + 2]).toBeCloseTo(origin[2] + k * h, 6);
        }
    });

    it('leaves nodes with no material inert', () => {
        const lattice = sphereLattice();
        // The padding ring is empty by construction, so its corners must have
        // zero inverse mass or they would fall forever.
        expect(lattice.invMass[nodeIndex(lattice.nodeDims, 0, 0, 0)]).toBe(0);
        expect([...lattice.invMass].some(m => m > 0)).toBe(true);
    });

    it('calls a node a surface node exactly when it can be reached from outside', () => {
        // Contact only ever touches these, so the two ways to get this wrong
        // both matter: a missing boundary node is a hole another body falls
        // through, and a buried one is work done for nothing.
        const lattice = sphereLattice();
        const surface = surfaceNodes(lattice);
        const claimed = new Set(surface);

        expect(surface.length).toBeGreaterThan(0);
        // The boundary of a solid is a surface, so it grows like the square of
        // the resolution while the body grows like the cube.
        const active = [...lattice.invMass].filter(m => m > 0).length;
        expect(surface.length).toBeLessThan(active);

        for (const node of surface) {
            expect(lattice.invMass[node]).toBeGreaterThan(0);
        }
        expect([...surface]).toEqual([...surface].sort((a, b) => a - b));

        // The centre of a sphere is as buried as a node gets, and the corner of
        // the padding ring is as far outside as one gets. Neither is a surface.
        const { nodeDims } = lattice;
        const middle = nodeDims.map(n => n >> 1);
        expect(claimed.has(nodeIndex(nodeDims, middle[0], middle[1], middle[2]))).toBe(false);
        expect(claimed.has(nodeIndex(nodeDims, 0, 0, 0))).toBe(false);
    });

    it('makes every corner of a lone cell a surface node', () => {
        // The degenerate case the general rule has to keep getting right: with
        // one cell occupied there is no interior at all, so all eight corners
        // are boundary and nothing else is.
        const cellDims = [3, 3, 3];
        const nodeDims = [4, 4, 4];
        const lattice = { cellDims, nodeDims, cells: [cellIndex(cellDims, 1, 1, 1)] };

        const surface = [...surfaceNodes(lattice)];
        expect(surface).toHaveLength(8);
        expect(surface).toEqual([...cellNodeIndices(nodeDims, 1, 1, 1)].sort((a, b) => a - b));
    });
});
