import { describe, expect, it } from 'vitest';

import { box, sphere, torus } from '../../../../apps/simulator/src/assets/shapes.js';
import { cellIndex, countOccupied, gridForBounds, morphologicalClose, voxelizeMesh, voxelizeSdf } from '../../src/sim/discretize/lattice/voxelize.js';
import { meshBounds, parseObj } from '../../../../apps/simulator/src/assets/objLoader.js';

/**
 * A closed axis-aligned box as a triangle mesh, for testing the mesh path
 * against a shape whose volume is known exactly.
 *
 * @param {number} half - Half extent.
 * @returns {import('../../../../apps/simulator/src/assets/objLoader.js').TriangleMesh} The mesh.
 */
function boxMesh(half) {
    const positions = new Float32Array([
        -half, -half, -half, half, -half, -half, half, half, -half, -half, half, -half,
        -half, -half, half, half, -half, half, half, half, half, -half, half, half
    ]);
    const indices = new Uint32Array([
        0, 2, 1, 0, 3, 2, // -z
        4, 5, 6, 4, 6, 7, // +z
        0, 1, 5, 0, 5, 4, // -y
        3, 7, 6, 3, 6, 2, // +y
        0, 4, 7, 0, 7, 3, // -x
        1, 2, 6, 1, 6, 5 //  +x
    ]);
    return { positions, indices };
}

describe('gridForBounds', () => {
    it('lays every axis out in elements of the requested size', () => {
        const grid = gridForBounds({ min: [0, 0, 0], max: [0.4, 0.2, 0.1] }, { elementSize: 0.02, padding: 2 });
        expect(grid.dims).toEqual([20 + 4, 10 + 4, 5 + 4]);
        expect(grid.h).toBe(0.02);
    });

    it('rounds a part of an element up rather than leaving material uncovered', () => {
        const grid = gridForBounds({ min: [0, 0, 0], max: [0.41, 0.2, 0.1] }, { elementSize: 0.02, padding: 2 });
        expect(grid.dims[0]).toBe(21 + 4);
    });

    it('does not round a whole number of elements up over float32 dust', () => {
        // Mesh vertices are float32, so a model normalised to 0.15 m spans
        // 0.15000000596 m -- and an author asking for 12.5 mm elements means
        // twelve of them, not a thirteenth for the last six nanometres.
        const extent = Math.fround(0.15);
        expect(extent).toBeGreaterThan(0.15);
        const grid = gridForBounds({ min: [0, 0, 0], max: [extent, extent, extent] }, { elementSize: 0.0125, padding: 2 });
        expect(grid.dims).toEqual([16, 16, 16]);
    });

    it('refuses to guess an element size', () => {
        // The option was called `resolution` and counted something else; a
        // caller still passing it must fail rather than quietly get a default.
        const bounds = { min: [0, 0, 0], max: [0.1, 0.1, 0.1] };
        expect(() => gridForBounds(bounds, {})).toThrow(/elementSize/);
        expect(() => gridForBounds(bounds, { resolution: 12 })).toThrow(/elementSize/);
        expect(() => gridForBounds(bounds, { elementSize: 0 })).toThrow(/elementSize/);
    });

    it('surrounds the shape with empty padding', () => {
        const padding = 2;
        const grid = gridForBounds({ min: [-1, -1, -1], max: [1, 1, 1] }, { elementSize: 0.25, padding });
        expect(grid.origin[0]).toBeCloseTo(-1 - padding * grid.h, 12);
        expect(countOccupied(grid)).toBe(0);
    });
});

describe('voxelizeSdf', () => {
    it('recovers the volume of a sphere', () => {
        const radius = 0.1;
        const grid = voxelizeSdf(sphere({ radius }), { elementSize: 2 * radius / 32 });
        const measured = countOccupied(grid) * grid.h ** 3;
        const exact = (4 / 3) * Math.PI * radius ** 3;
        // Over-filling is deliberate -- a cell holding surface but no material
        // is what tears the render geometry embedded in it -- so allow a bias.
        // The corner test that guarantees containment costs the last point of
        // it, by claiming cells the surface only clips near a corner.
        expect(measured / exact).toBeGreaterThan(1.0);
        expect(measured / exact).toBeLessThan(1.16);
    });

    it('leaves the hole of a torus empty', () => {
        const shape = torus({ majorRadius: 0.08, minorRadius: 0.03 });
        const grid = voxelizeSdf(shape, { elementSize: 0.22 / 28 });
        const centre = [0, 1, 2].map(a => Math.floor((0 - grid.origin[a]) / grid.h));
        expect(grid.occupancy[cellIndex(grid, centre[0], centre[1], centre[2])]).toBe(0);
        expect(countOccupied(grid)).toBeGreaterThan(0);
    });
});

describe('voxelizeMesh', () => {
    it('recovers the volume of a closed box', () => {
        const half = 0.5;
        const mesh = boxMesh(half);
        const grid = voxelizeMesh(mesh, meshBounds(mesh.positions), { elementSize: 2 * half / 20 });
        const measured = countOccupied(grid) * grid.h ** 3;
        const exact = (2 * half) ** 3;
        expect(measured / exact).toBeGreaterThan(0.95);
        expect(measured / exact).toBeLessThan(1.35);
    });

    it('survives an open hole in the surface', () => {
        // Drop the -y face: a single-axis parity test would flood the interior
        // out through the opening. The three-axis vote should not.
        const mesh = boxMesh(0.5);
        const withHole = {
            positions: mesh.positions,
            // Triangles 4 and 5 are the -y face; indices [12, 18).
            indices: new Uint32Array([...mesh.indices.slice(0, 12), ...mesh.indices.slice(18)])
        };
        const grid = voxelizeMesh(withHole, meshBounds(withHole.positions), { elementSize: 1 / 16 });
        const measured = countOccupied(grid) * grid.h ** 3;
        const exact = 1.0;
        expect(measured / exact).toBeGreaterThan(0.7);
    });

    it('parses and voxelises an OBJ without leaking everywhere', () => {
        const objText = [
            'v -0.5 -0.5 -0.5', 'v 0.5 -0.5 -0.5', 'v 0.5 0.5 -0.5', 'v -0.5 0.5 -0.5',
            'v -0.5 -0.5 0.5', 'v 0.5 -0.5 0.5', 'v 0.5 0.5 0.5', 'v -0.5 0.5 0.5',
            'f 1 3 2', 'f 1 4 3', 'f 5 6 7', 'f 5 7 8',
            'f 1 2 6', 'f 1 6 5', 'f 4 8 7', 'f 4 7 3',
            'f 1 5 8', 'f 1 8 4', 'f 2 3 7', 'f 2 7 6'
        ].join('\n');
        const mesh = parseObj(objText);
        expect(mesh.positions).toHaveLength(24);
        expect(mesh.indices).toHaveLength(36);

        const grid = voxelizeMesh(mesh, meshBounds(mesh.positions), { elementSize: 1 / 12 });
        const fillRatio = countOccupied(grid) / grid.occupancy.length;
        expect(fillRatio).toBeGreaterThan(0.1);
        expect(fillRatio).toBeLessThan(0.75);
    });
});

describe('morphologicalClose', () => {
    it('seals a one-cell pit without eating the body', () => {
        const grid = voxelizeSdf(box({ halfExtents: [0.1, 0.1, 0.1] }), { elementSize: 0.2 / 12 });
        const before = countOccupied(grid);

        const pit = cellIndex(grid, Math.floor(grid.dims[0] / 2), Math.floor(grid.dims[1] / 2), Math.floor(grid.dims[2] / 2));
        grid.occupancy[pit] = 0;
        expect(countOccupied(grid)).toBe(before - 1);

        morphologicalClose(grid);
        expect(grid.occupancy[pit]).toBe(1);
        expect(countOccupied(grid)).toBe(before);
    });
});
