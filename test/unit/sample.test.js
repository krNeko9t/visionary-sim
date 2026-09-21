import { describe, expect, it } from 'vitest';

import {
    evaluateDeformationGradient,
    evaluatePosition,
    locate,
    trilinearGradients,
    trilinearWeights
} from '../../src/sim/discretize/lattice/sample.js';
import { buildLattice, cellNodeIndices } from '../../src/sim/discretize/lattice/lattice.js';
import { box } from '../../src/assets/shapes.js';
import { voxelizeSdf } from '../../src/sim/discretize/lattice/voxelize.js';

const SPACE = { origin: [-0.1, 0, -0.05], h: 0.02, cellDims: [10, 8, 6] };

describe('locate', () => {
    it('splits a position into cell index and local coordinates', () => {
        const { cell, local } = locate(SPACE, -0.1 + 0.02 * 3.25, 0.02 * 1.5, -0.05 + 0.02 * 0.75);
        expect(cell).toEqual([3, 1, 0]);
        expect(local[0]).toBeCloseTo(0.25, 6);
        expect(local[1]).toBeCloseTo(0.5, 6);
        expect(local[2]).toBeCloseTo(0.75, 6);
    });

    it('extrapolates rather than snapping when a point leaves the grid', () => {
        const { cell, local } = locate(SPACE, -0.1 - 0.02, 0, -0.05);
        expect(cell[0]).toBe(0);
        expect(local[0]).toBeCloseTo(-1, 6);
    });
});

describe('trilinear weights', () => {
    it('forms a partition of unity', () => {
        for (const local of [[0, 0, 0], [1, 1, 1], [0.5, 0.5, 0.5], [0.13, 0.87, 0.41]]) {
            const weights = trilinearWeights(local);
            const sum = weights.reduce((a, b) => a + b, 0);
            expect(sum).toBeCloseTo(1, 6);
            for (const w of weights) {
                expect(w).toBeGreaterThanOrEqual(-1e-7);
            }
        }
    });

    it('collapses onto a single corner at that corner', () => {
        const weights = trilinearWeights([1, 0, 1]);
        // Corner (1, 0, 1) is index 1 | 4 = 5.
        expect(weights[5]).toBeCloseTo(1, 6);
        expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    });

    it('has gradients that sum to zero', () => {
        // A constant field must have zero deformation gradient contribution.
        const gradients = trilinearGradients([0.3, 0.6, 0.2], 0.02);
        for (let axis = 0; axis < 3; axis++) {
            let sum = 0;
            for (let c = 0; c < 8; c++) {
                sum += gradients[c * 3 + axis];
            }
            expect(sum).toBeCloseTo(0, 6);
        }
    });
});

describe('the deformation field reproduces affine motion exactly', () => {
    // This is the property the whole renderer rests on. If the field can
    // reproduce an affine map, then rigid rotations of a body carry splats and
    // vertices along without distortion, and F recovers the exact linear part
    // for rotating Gaussian covariances.
    const lattice = buildLattice(voxelizeSdf(box({ halfExtents: [0.06, 0.05, 0.04] }), { elementSize: 0.12 / 10 }), { density: 1000 });
    const space = { origin: lattice.origin, h: lattice.h, cellDims: lattice.cellDims };

    /** An arbitrary non-symmetric affine map, column-major. */
    const A = [1.13, 0.21, -0.07, -0.05, 0.94, 0.16, 0.09, -0.11, 1.27];
    const b = [0.031, -0.017, 0.048];

    const deformed = new Float32Array(lattice.restPositions.length);
    for (let n = 0; n < lattice.nodeCount; n++) {
        const base = n * 3;
        const [x, y, z] = [lattice.restPositions[base], lattice.restPositions[base + 1], lattice.restPositions[base + 2]];
        for (let row = 0; row < 3; row++) {
            deformed[base + row] = A[row] * x + A[3 + row] * y + A[6 + row] * z + b[row];
        }
    }

    const samples = [
        [lattice.origin[0] + lattice.h * 3.3, lattice.origin[1] + lattice.h * 2.7, lattice.origin[2] + lattice.h * 1.1],
        [lattice.origin[0] + lattice.h * 5.9, lattice.origin[1] + lattice.h * 4.2, lattice.origin[2] + lattice.h * 3.8],
        [lattice.origin[0] + lattice.h * 0.5, lattice.origin[1] + lattice.h * 0.5, lattice.origin[2] + lattice.h * 0.5]
    ];

    it('interpolates positions exactly', () => {
        for (const point of samples) {
            const { cell, local } = locate(space, ...point);
            const nodes = cellNodeIndices(lattice.nodeDims, ...cell);
            const actual = evaluatePosition(deformed, nodes, trilinearWeights(local));

            for (let row = 0; row < 3; row++) {
                const expected = A[row] * point[0] + A[3 + row] * point[1] + A[6 + row] * point[2] + b[row];
                expect(actual[row]).toBeCloseTo(expected, 5);
            }
        }
    });

    it('recovers the linear part as the deformation gradient', () => {
        for (const point of samples) {
            const { cell, local } = locate(space, ...point);
            const nodes = cellNodeIndices(lattice.nodeDims, ...cell);
            const F = evaluateDeformationGradient(deformed, nodes, trilinearGradients(local, lattice.h));

            for (let i = 0; i < 9; i++) {
                expect(F[i]).toBeCloseTo(A[i], 4);
            }
        }
    });
});
