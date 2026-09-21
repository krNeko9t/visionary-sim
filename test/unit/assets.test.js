import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { locate } from '../../src/deformation/sample.js';
import { buildLattice } from '../../src/sim/discretize/lattice/lattice.js';
import { meshBounds, normalizeMesh, parseObj } from '../../src/assets/objLoader.js';
import { cellIndex, countOccupied, voxelizeMesh } from '../../src/sim/discretize/lattice/voxelize.js';

/**
 * @param {string} name - File name under public/models.
 * @returns {import('../../src/assets/objLoader.js').TriangleMesh} The mesh.
 */
function loadAsset(name) {
    const path = fileURLToPath(new URL(`../../public/models/${name}`, import.meta.url));
    return parseObj(readFileSync(path, 'utf8'));
}

describe.each([
    { name: 'spot.obj', minVertices: 2900, resolution: 16 },
    { name: 'suzanne.obj', minVertices: 500, resolution: 16 }
])('$name survives the geometry pipeline', ({ name, minVertices, resolution }) => {
    const mesh = loadAsset(name);
    normalizeMesh(mesh.positions, 0.17);
    const grid = voxelizeMesh(mesh, meshBounds(mesh.positions), { resolution });

    it('parses into a non-degenerate triangle mesh', () => {
        expect(mesh.positions.length / 3).toBeGreaterThanOrEqual(minVertices);
        expect(mesh.indices.length % 3).toBe(0);
        expect(mesh.indices.length).toBeGreaterThan(0);
        expect([...mesh.positions].every(Number.isFinite)).toBe(true);
    });

    it('voxelises to a solid that is neither empty nor the whole grid', () => {
        const fill = countOccupied(grid) / grid.occupancy.length;
        expect(fill).toBeGreaterThan(0.02);
        expect(fill).toBeLessThan(0.6);
    });

    it('covers every render vertex with an occupied cell', () => {
        // The precondition for M3: a vertex whose cell holds no material has no
        // support in the deformation field and would be driven by inert nodes,
        // tearing that part of the surface off the body. Voxelisation
        // deliberately over-fills by half a cell to guarantee this.
        const space = { origin: grid.origin, h: grid.h, cellDims: grid.dims };
        let uncovered = 0;

        for (let v = 0; v < mesh.positions.length; v += 3) {
            const { cell } = locate(space, mesh.positions[v], mesh.positions[v + 1], mesh.positions[v + 2]);
            if (grid.occupancy[cellIndex(grid, cell[0], cell[1], cell[2])] === 0) {
                uncovered++;
            }
        }
        expect(uncovered).toBe(0);
    });

    it('keeps every render vertex inside the padded grid', () => {
        // Trilinear embedding needs a full cell of support, so no vertex may
        // sit in the outermost cell layer where a corner would fall off-grid.
        const space = { origin: grid.origin, h: grid.h, cellDims: grid.dims };

        for (let v = 0; v < mesh.positions.length; v += 3) {
            const { cell } = locate(space, mesh.positions[v], mesh.positions[v + 1], mesh.positions[v + 2]);
            for (let axis = 0; axis < 3; axis++) {
                expect(cell[axis]).toBeGreaterThan(0);
                expect(cell[axis]).toBeLessThan(grid.dims[axis] - 1);
            }
        }
    });

    it('builds a lattice whose mass matches its occupied volume', () => {
        const lattice = buildLattice(grid, { density: 1000 });
        expect(lattice.mass).toBeCloseTo(1000 * lattice.volume, 6);
        expect(lattice.cells.length).toBe(countOccupied(grid));
    });
});
