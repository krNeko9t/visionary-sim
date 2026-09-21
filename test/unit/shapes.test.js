import { describe, expect, it } from 'vitest';

import { box, sphere, torus, translateShape } from '../../src/assets/shapes.js';
import { locate } from '../../src/sim/discretize/lattice/sample.js';
import { buildLattice, cellIndex } from '../../src/sim/discretize/lattice/lattice.js';
import { voxelizeSdf } from '../../src/sim/discretize/lattice/voxelize.js';

/**
 * An analytic shape has two descriptions of itself -- a distance function the
 * simulator reads and triangles the renderer draws -- and nothing forces them
 * to agree. These tests are that force.
 */

/**
 * Numerical gradient of a distance function, which points out of the surface.
 *
 * @param {import('../../src/assets/shapes.js').Shape} shape - Shape to probe.
 * @param {number[]} at - Point to probe at.
 * @param {number} [eps] - Step size.
 * @returns {number[]} The gradient.
 */
function sdfGradient(shape, [x, y, z], eps = 1e-5) {
    return [
        shape.sdf(x + eps, y, z) - shape.sdf(x - eps, y, z),
        shape.sdf(x, y + eps, z) - shape.sdf(x, y - eps, z),
        shape.sdf(x, y, z + eps) - shape.sdf(x, y, z - eps)
    ].map(d => d / (2 * eps));
}

const SHAPES = [
    { name: 'sphere', shape: sphere({ radius: 0.05 }), scale: 0.05 },
    { name: 'torus', shape: torus({ majorRadius: 0.052, minorRadius: 0.022 }), scale: 0.022 },
    { name: 'box', shape: box({ halfExtents: [0.045, 0.035, 0.045] }), scale: 0.045 }
];

describe.each(SHAPES)('$name', ({ shape, scale }) => {
    const { positions, indices } = shape.surface;

    it('puts every surface vertex on the zero level set', () => {
        let worst = 0;
        for (let v = 0; v < positions.length; v += 3) {
            worst = Math.max(worst, Math.abs(shape.sdf(positions[v], positions[v + 1], positions[v + 2])));
        }
        expect(worst).toBeLessThan(scale * 1e-6);
    });

    it('faces every triangle outwards', () => {
        // Winding decides which way the renderer thinks a surface points, and a
        // shape that got it backwards is invisible rather than obviously wrong.
        // The distance function already knows the answer, so ask it.
        let inwards = 0;
        let checked = 0;

        for (let t = 0; t < indices.length; t += 3) {
            const [a, b, c] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3];
            const ab = [0, 1, 2].map(axis => positions[b + axis] - positions[a + axis]);
            const ac = [0, 1, 2].map(axis => positions[c + axis] - positions[a + axis]);
            const normal = [
                ab[1] * ac[2] - ab[2] * ac[1],
                ab[2] * ac[0] - ab[0] * ac[2],
                ab[0] * ac[1] - ab[1] * ac[0]
            ];

            // Poles of a closed patch collapse to a point; those triangles have
            // no area and so no direction to be wrong about.
            const area = Math.hypot(...normal);
            if (area < scale * scale * 1e-6) {
                continue;
            }

            const centroid = [0, 1, 2].map(axis =>
                (positions[a + axis] + positions[b + axis] + positions[c + axis]) / 3);
            const gradient = sdfGradient(shape, centroid);
            const alignment = normal.reduce((sum, n, axis) => sum + n * gradient[axis], 0);

            checked++;
            if (alignment <= 0) {
                inwards++;
            }
        }

        expect(checked).toBeGreaterThan(0);
        expect(inwards).toBe(0);
    });

    it('keeps its two descriptions together when moved', () => {
        const moved = translateShape(shape, [0.3, -0.2, 0.11]);
        const surface = moved.surface.positions;

        for (let v = 0; v < surface.length; v += 3) {
            expect(Math.abs(moved.sdf(surface[v], surface[v + 1], surface[v + 2]))).toBeLessThan(scale * 1e-6);
        }
        // Moving a shape must not move the one it was made from.
        expect(shape.surface.positions[0]).not.toBe(surface[0]);
    });

    it.each([8, 9, 10, 12, 16])('embeds every surface vertex in solid material at resolution %i', (resolution) => {
        // The precondition for being drawn at all, and it is about the eight
        // corner nodes rather than about the vertex: a node with no material
        // never moves, and one of those among the eight tears the deformation
        // gradient the vertex reads even where its interpolation weight is
        // zero. That shows up as a black speck on the surface.
        //
        // An occupied cell has mass on all eight of its corners by
        // construction, so this is the whole of the condition. Swept across
        // resolutions because the failure it guards against was an alignment
        // between the surface and the grid, which one resolution can hide.
        const lattice = buildLattice(voxelizeSdf(shape, { resolution }), { density: 1000 });
        const space = { origin: lattice.origin, h: lattice.h, cellDims: lattice.cellDims };
        const occupied = new Set(lattice.cells);
        let uncovered = 0;

        for (let v = 0; v < positions.length; v += 3) {
            const { cell } = locate(space, positions[v], positions[v + 1], positions[v + 2]);
            if (!occupied.has(cellIndex(lattice.cellDims, cell[0], cell[1], cell[2]))) {
                uncovered++;
            }
        }
        expect(uncovered).toBe(0);
    });

    it('does not pay for that with a much larger body', () => {
        // Containing the surface means over-filling, and over-filling is only
        // acceptable while it stays at the half cell the sampling intends. A
        // whole extra layer would leave the body visibly hovering above the
        // floor it is resting on.
        const lattice = buildLattice(voxelizeSdf(shape, { resolution: 12 }), { density: 1000 });
        const extent = [0, 1, 2].map(axis => shape.bounds.max[axis] - shape.bounds.min[axis]);
        const grown = extent.map(e => (e + lattice.h) / e).reduce((a, b) => a * b, 1);

        expect(lattice.volume).toBeLessThan(extent.reduce((a, b) => a * b, 1) * grown);
    });
});
