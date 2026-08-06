import { describe, expect, it } from 'vitest';

import { box, sphere, torus } from '../../src/geometry/shapes.js';
import { cellIndex, countOccupied, gridForBounds, morphologicalClose, voxelizeMesh, voxelizeSdf } from '../../src/geometry/voxelize.js';
import { meshBounds, parseObj } from '../../src/geometry/objLoader.js';

/**
 * A closed axis-aligned box as a triangle mesh, for testing the mesh path
 * against a shape whose volume is known exactly.
 *
 * @param {number} half - Half extent.
 * @returns {import('../../src/geometry/objLoader.js').TriangleMesh} The mesh.
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
    it('gives the longest axis exactly the requested resolution', () => {
        const grid = gridForBounds({ min: [0, 0, 0], max: [0.4, 0.2, 0.1] }, { resolution: 20, padding: 2 });
        expect(grid.dims[0]).toBe(20 + 4);
        expect(grid.h).toBeCloseTo(0.02, 12);
    });

    it('surrounds the shape with empty padding', () => {
        const padding = 2;
        const grid = gridForBounds({ min: [-1, -1, -1], max: [1, 1, 1] }, { resolution: 8, padding });
        expect(grid.origin[0]).toBeCloseTo(-1 - padding * grid.h, 12);
        expect(countOccupied(grid)).toBe(0);
    });
});

describe('voxelizeSdf', () => {
    it('recovers the volume of a sphere', () => {
        const radius = 0.1;
        const grid = voxelizeSdf(sphere({ radius }), { resolution: 32 });
        const measured = countOccupied(grid) * grid.h ** 3;
        const exact = (4 / 3) * Math.PI * radius ** 3;
        // The half-cell threshold deliberately over-fills, so allow a bias.
        expect(measured / exact).toBeGreaterThan(1.0);
        expect(measured / exact).toBeLessThan(1.15);
    });

    it('leaves the hole of a torus empty', () => {
        const shape = torus({ majorRadius: 0.08, minorRadius: 0.03 });
        const grid = voxelizeSdf(shape, { resolution: 28 });
        const centre = [0, 1, 2].map(a => Math.floor((0 - grid.origin[a]) / grid.h));
        expect(grid.occupancy[cellIndex(grid, centre[0], centre[1], centre[2])]).toBe(0);
        expect(countOccupied(grid)).toBeGreaterThan(0);
    });
});

describe('voxelizeMesh', () => {
    it('recovers the volume of a closed box', () => {
        const half = 0.5;
        const mesh = boxMesh(half);
        const grid = voxelizeMesh(mesh, meshBounds(mesh.positions), { resolution: 20 });
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
        const grid = voxelizeMesh(withHole, meshBounds(withHole.positions), { resolution: 16 });
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

        const grid = voxelizeMesh(mesh, meshBounds(mesh.positions), { resolution: 12 });
        const fillRatio = countOccupied(grid) / grid.occupancy.length;
        expect(fillRatio).toBeGreaterThan(0.1);
        expect(fillRatio).toBeLessThan(0.75);
    });
});

describe('morphologicalClose', () => {
    it('seals a one-cell pit without eating the body', () => {
        const grid = voxelizeSdf(box({ halfExtents: [0.1, 0.1, 0.1] }), { resolution: 12 });
        const before = countOccupied(grid);

        const pit = cellIndex(grid, Math.floor(grid.dims[0] / 2), Math.floor(grid.dims[1] / 2), Math.floor(grid.dims[2] / 2));
        grid.occupancy[pit] = 0;
        expect(countOccupied(grid)).toBe(before - 1);

        morphologicalClose(grid);
        expect(grid.occupancy[pit]).toBe(1);
        expect(countOccupied(grid)).toBe(before);
    });
});
