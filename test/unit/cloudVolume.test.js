import { describe, expect, it } from 'vitest';

import { countOccupied } from '../../src/sim/discretize/lattice/voxelize.js';
import { locate } from '../../src/sim/discretize/lattice/sample.js';
import { mat3FromQuat } from '../../src/sim/discretize/mat3.js';
import { voxelizeCloud } from '../../src/sim/discretize/lattice/cloudVolume.js';

/**
 * Turning a capture into something the solver can move.
 *
 * On synthetic clouds, for the reason `splats.test.js` gives: the two PLYs this
 * was developed against are 61 MB of someone else's scan and are not in the
 * repository, so a suite that needed them would not run on a fresh clone. What
 * is checked here is what a synthetic cloud can settle -- the invariant, the
 * fill, and the failure mode -- and the numbers those two produced are recorded
 * in the module's own comment.
 */

/**
 * A cloud of identical, unrotated Gaussians at the given centres.
 *
 * @param {number[]} points - Centres, 3 per Gaussian.
 * @param {number} radius - Standard deviation, the same on all three axes.
 * @returns {import('../../src/assets/splats/cloud.js').SplatCloud} The cloud.
 */
function cloudAt(points, radius) {
    const count = points.length / 3;
    const cloud = {
        count,
        positions: Float32Array.from(points),
        rotations: new Float32Array(count * 4),
        scales: new Float32Array(count * 3).fill(radius),
        opacity: new Float32Array(count).fill(1),
        colors: new Float32Array(count * 3).fill(0.5)
    };
    for (let i = 0; i < count; i++) {
        cloud.rotations[i * 4 + 3] = 1;
    }
    return cloud;
}

/**
 * Points spread evenly over a sphere, the way a capture covers a surface: only
 * the outside, with nothing behind it.
 *
 * @param {number} radius - Sphere radius.
 * @param {number} count - How many points.
 * @param {number} [cover] - Fraction of the sphere kept, from the south pole up.
 *   Below 1 the shell has a hole in it.
 * @returns {number[]} The points, 3 per sample.
 */
function sphereShell(radius, count, cover = 1) {
    const golden = Math.PI * (3 - Math.sqrt(5));
    const points = [];

    for (let i = 0; i < count; i++) {
        const y = 1 - (2 * (i + 0.5)) / count;
        if (y > 2 * cover - 1) {
            continue;
        }
        const ring = Math.sqrt(Math.max(0, 1 - y * y));
        const theta = golden * i;
        points.push(Math.cos(theta) * ring * radius, y * radius, Math.sin(theta) * ring * radius);
    }
    return points;
}

/**
 * @param {import('../../src/sim/discretize/lattice/voxelize.js').OccupancyGrid} grid - The grid.
 * @param {number[]} point - A world position.
 * @returns {number} 1 when the cell holding it is material.
 */
function occupancyAt(grid, point) {
    const { cell } = locate({ origin: grid.origin, h: grid.h, cellDims: grid.dims }, ...point);
    return grid.occupancy[cell[0] + grid.dims[0] * (cell[1] + grid.dims[1] * cell[2])];
}

const RADIUS = 0.05;
/** A Gaussian a sixtieth of the object across, which is what a capture gives. */
const SPREAD = 0.0008;
const SHELL = sphereShell(RADIUS, 6000);

describe('voxelizeCloud', () => {
    it('puts every Gaussian centre in a solid cell, at every element size', () => {
        // The hard boundary, and the reason for the whole module. A centre in an
        // empty cell reads a deformation gradient torn between nodes that moved
        // and nodes with no mass, and the Gaussian drawn there smears. Checked
        // at several element sizes because the failure comes from the surface
        // landing badly against the grid, which a single size hides --
        // the same reason `shapes.test.js` sweeps.
        //
        // Deliberately asked through `locate`, which is what the render side
        // uses to find its cell. Re-deriving the arithmetic here would let the
        // two drift apart and still agree with each other.
        const cloud = cloudAt(SHELL, SPREAD);

        // About 8 to 32 cells across the 0.1 m ball, at sizes that land it
        // differently against the grid each time.
        for (const elementSize of [0.013, 0.0086, 0.0065, 0.0043, 0.0032]) {
            const grid = voxelizeCloud(cloud, { elementSize });
            let outside = 0;

            for (let i = 0; i < cloud.count; i++) {
                const centre = [...cloud.positions.slice(i * 3, i * 3 + 3)];
                outside += occupancyAt(grid, centre) === 0 ? 1 : 0;
            }
            expect(outside, `elementSize ${elementSize}`).toBe(0);
        }
    });

    it('turns a shell of Gaussians into a solid body', () => {
        // A capture samples a surface and nothing behind it, so without the fill
        // the "body" is a bag: the right silhouette, a third of the mass, and it
        // deforms like a balloon.
        const cloud = cloudAt(SHELL, SPREAD);
        const shell = voxelizeCloud(cloud, { elementSize: 0.005, fill: false });
        const solid = voxelizeCloud(cloud, { elementSize: 0.005 });

        const exact = (4 / 3) * Math.PI * RADIUS ** 3;
        expect(countOccupied(shell) * shell.h ** 3 / exact).toBeLessThan(0.7);

        const measured = countOccupied(solid) * solid.h ** 3;
        // Over-filled rather than under, for the reason `voxelizeSdf` is: a cell
        // holding a visible thing but no material is what tears it. More
        // over-filled than the SDF path, and by a known amount: stamping at two
        // standard deviations adds that much to the radius before the grid even
        // rounds it up.
        expect(measured / exact).toBeGreaterThan(1.15);
        expect(measured / exact).toBeLessThan(1.45);
    });

    it('converges on the volume as the cells get smaller', () => {
        // A shell that never sealed would report a volume that halves with the
        // cell size instead of settling, so this is the assertion that says the
        // fill really filled rather than merely running.
        const cloud = cloudAt(SHELL, SPREAD);
        const exact = (4 / 3) * Math.PI * RADIUS ** 3;
        const error = elementSize => {
            const grid = voxelizeCloud(cloud, { elementSize });
            return Math.abs(countOccupied(grid) * grid.h ** 3 - exact) / exact;
        };

        expect(error(0.0037)).toBeLessThan(error(0.01) * 0.7);
    });

    it('leaves an open capture hollow rather than flooding it', () => {
        // The failure mode, asserted so that it stays the conservative one. A
        // shell with a hole lets the exterior in and the body comes out hollow;
        // the alternative -- flooding outward from a seed -- would make one leak
        // fill the entire bounding box, and would look fine until it did not.
        const open = cloudAt(sphereShell(RADIUS, 6000, 0.75), SPREAD);
        const shell = countOccupied(voxelizeCloud(open, { elementSize: 0.005, fill: false }));
        const filled = countOccupied(voxelizeCloud(open, { elementSize: 0.005 }));

        expect(filled).toBeLessThan(shell * 1.5);
    });

    it('keeps the padding ring clear', () => {
        // Two things need it: trilinear embedding wants a full cell of support
        // around every point it carries, and the fill starts from the faces, so
        // material reaching them would shut it out.
        const grid = voxelizeCloud(cloudAt(SHELL, SPREAD), { elementSize: 0.0065 });
        const [nx, ny, nz] = grid.dims;
        let onFace = 0;

        for (let k = 0; k < nz; k++) {
            for (let j = 0; j < ny; j++) {
                for (let i = 0; i < nx; i++) {
                    if (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1) {
                        onFace += grid.occupancy[i + nx * (j + ny * k)];
                    }
                }
            }
        }
        expect(onFace).toBe(0);
    });

    it('stamps a Gaussian along its own axes, not the world\'s', () => {
        // One long thin Gaussian, turned a quarter turn about z. If the rotation
        // were dropped or transposed the material would come out lying along x.
        // At two standard deviations the long axis reaches 0.1 m and the short
        // ones 0.008, so the two probes are unambiguous either way.
        const long = cloudAt([0, 0, 0], 1);
        long.scales.set([0.05, 0.004, 0.004]);
        long.rotations.set([0, 0, Math.SQRT1_2, Math.SQRT1_2]);

        const grid = voxelizeCloud(long, { elementSize: 0.0125, fill: false });
        expect(occupancyAt(grid, [0, 0.08, 0])).toBe(1);
        expect(occupancyAt(grid, [0.08, 0, 0])).toBe(0);
    });

    it('refuses a cloud with nothing in it', () => {
        expect(() => voxelizeCloud(cloudAt([], 0.01))).toThrow(/no Gaussians/);
        expect(() => voxelizeCloud(cloudAt([0, 0, 0], 0))).toThrow(/no extent/);
    });
});

describe('mat3FromQuat', () => {
    it('agrees with rotating the basis vectors', () => {
        // A quarter turn about z takes x to y and y to -x. Column-major, so
        // column k -- `m[k * 3 .. k * 3 + 2]` -- is where basis vector k lands.
        const m = mat3FromQuat([0, 0, Math.SQRT1_2, Math.SQRT1_2]);
        const expected = [0, 1, 0, -1, 0, 0, 0, 0, 1];

        for (let at = 0; at < 9; at++) {
            expect(m[at], `element ${at}`).toBeCloseTo(expected[at], 6);
        }
    });

    it('is orthonormal for any unit quaternion', () => {
        const q = [0.3, -0.5, 0.2, 0.7];
        const length = Math.hypot(...q);
        const m = mat3FromQuat(q.map(v => v / length));

        for (let a = 0; a < 3; a++) {
            for (let b = 0; b < 3; b++) {
                const dot = m[a * 3] * m[b * 3] + m[a * 3 + 1] * m[b * 3 + 1] + m[a * 3 + 2] * m[b * 3 + 2];
                expect(dot).toBeCloseTo(a === b ? 1 : 0, 6);
            }
        }
    });
});
