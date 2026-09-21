import { CUBE_CORNERS } from '../../../deformation/corners.js';
import { cellIndex, dilated, eroded, gridForBounds } from './voxelize.js';
import { mat3FromQuat } from '../mat3.js';

/**
 * Giving a cloud of Gaussians an inside.
 *
 * The other two sources are *told* where the material is: a shape's distance
 * function has a sign, and a closed mesh has a ray parity. A capture has
 * neither. It is a set of samples taken on a surface -- often only the side a
 * camera could see -- and it says nothing at all about what is behind that
 * surface. Inventing an interior is not a detail of reading the file, it is the
 * entire content of this module, which is why it is here and not in
 * `voxelize.js` next to the two sources that came with an answer.
 *
 * The answer chosen is the cheap one, and it is chosen because it matches what
 * the solver needs rather than what a reconstruction would want: stamp every
 * Gaussian as a solid ellipsoid, then call everything the outside cannot reach
 * material. For a capture of one opaque object that turns a shell into a body of
 * roughly the right mass without anyone authoring a volume.
 *
 * What makes it work at all is {@link SEAL}, and the number is not cosmetic: a
 * stamped shell is porous once the cells are smaller than the spacing between
 * samples, and no amount of care over the ellipsoids closes it -- the samples
 * are simply not there. `bread.ply` is 46321 Gaussians of median radius 1.1 mm,
 * and at 6.8 mm cells its 4961-cell shell fills like this:
 *
 *     seal 0   x1.00   the exterior walks in through the holes; still a shell
 *     seal 1   x1.61   sealed, and solid: 76% of its cells are interior
 *     seal 2   x1.61   the same, with a cell of margin
 *
 * At 13.5 mm cells the same capture never needed a seal at all. So the fill runs
 * on a shell dilated until it is watertight and the result is eroded back --
 * a close with an element wide enough to span the gaps. The alternative,
 * flooding outward from a seed inside, needs no seal and fails far worse: one
 * leak and the body fills its own bounding box.
 *
 * Two things this deliberately does not do:
 *
 *   - It does not try to be right about open captures. A shell with a real hole
 *     in it -- wider than the seal -- lets the exterior in, and what comes out is
 *     a hollow body instead of a solid one. That failure mode is worth keeping,
 *     because it is the conservative one and it has a signature: a hollow body's
 *     volume keeps halving with the cell size instead of settling on a number.
 *     `test/unit/cloudVolume.test.js` asserts that it settles.
 *   - It does not clean. A cloud arriving here has already been filtered in
 *     `assets/`, and that is not tidiness: the same filter has to govern what is
 *     *drawn* (see `assets/splats/clean.js`), so it cannot live on one bank.
 *     Junk left in would put mass and cells where nothing is visible, and would
 *     size the grid from a floater.
 *
 * The hard boundary owed to the render side is the mesh rule with a different
 * subject: **every Gaussian that will be drawn must have its centre in a solid
 * cell.** A centre in an empty cell reads a deformation gradient torn between
 * nodes that moved and nodes that have no mass, exactly as a mesh vertex does;
 * the artefact is a smeared blob rather than a black speck, but the cause is the
 * same. It holds here by construction rather than by tuning -- the cell holding
 * a centre is marked before any geometry is tested, whatever the Gaussian's
 * size, and the last thing the fill does is put the stamp back on top of itself.
 */

/**
 * Standard deviations of a Gaussian that count as material.
 *
 * Two, because that is roughly where the renderer stops drawing one, so the
 * solid extent and the visible extent are the same claim. Over-filling remains
 * the cheaper mistake for the same reason it is in `voxelizeSdf`: a cell holding
 * a visible thing but no material is what tears the geometry embedded in it.
 */
const SIGMA = 2;

/**
 * How far the shell is thickened before the fill, in cells; gaps up to twice
 * this are spanned.
 *
 * One cell is what the porous case above actually needs, and this is one more
 * than that. The margin is asymmetric on purpose: too small leaves a hollow body
 * and a mass off by a third, while too large bridges gaps the object really has
 * -- on `wolf.ply`, which has limbs to bridge between, going from no seal to
 * this one adds 3 to 5% to the volume. A tenth of the error, in the direction
 * this file already prefers.
 */
const SEAL = 2;

/** Where a cell is tested against an ellipsoid: its eight corners, then its centre. */
const CELL_SAMPLES = [...CUBE_CORNERS, [0.5, 0.5, 0.5]];

/** The 6-neighbourhood, as offsets. Faces only: a diagonal gap is not a way through. */
const NEIGHBOURS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/**
 * @param {import('../../assets/splats/cloud.js').SplatCloud} cloud - Gaussians in world space.
 * @param {object} [options] - Layout and method options.
 * @param {number} [options.resolution] - Cells along the longest axis.
 * @param {number} [options.padding] - Empty cells added on every side.
 * @param {number} [options.sigma] - Standard deviations counted as material.
 * @param {number} [options.seal] - Cells the shell is thickened by before filling.
 * @param {boolean} [options.fill] - Make everything the outside cannot reach material.
 * @returns {import('./voxelize.js').OccupancyGrid} The filled grid.
 */
export function voxelizeCloud(cloud, options = {}) {
    const { sigma = SIGMA, seal = SEAL, fill = true } = options;
    if (cloud.count === 0) {
        throw new Error('voxelizeCloud: a cloud with no Gaussians has no volume');
    }

    // Over the ellipsoids rather than over the centres, because the ellipsoids
    // are where the material is: a Gaussian is a blob, and a grid laid out to
    // the points at their middles would have the outer half of the outermost
    // ones hanging over the edge. It costs a couple of percent of resolution on
    // a real capture, where a Gaussian is a hundredth of the object.
    const bounds = materialBounds(cloud, sigma);
    if (!(Math.max(...bounds.min.map((v, axis) => bounds.max[axis] - v)) > 0)) {
        throw new Error('voxelizeCloud: a cloud with no extent has no volume');
    }

    const grid = gridForBounds(bounds, options);
    stampCloud(cloud, grid, sigma);
    if (fill) {
        sealAndFill(grid, seal);
    }
    return grid;
}

/**
 * Marks every cell that a Gaussian's ellipsoid reaches.
 *
 * The stamp stops one cell short of the grid's faces, which the padding ring
 * already guarantees -- the grid was laid out to hold these very ellipsoids, so
 * none of them can reach a face. Saying it twice is on purpose: the flood needs
 * empty cells to start from, and that requirement should not be reachable only
 * by arguing from how the bounds were chosen two functions ago.
 *
 * @param {import('../../assets/splats/cloud.js').SplatCloud} cloud - The Gaussians.
 * @param {import('./voxelize.js').OccupancyGrid} grid - Grid to mark in place.
 * @param {number} sigma - Standard deviations counted as material.
 */
function stampCloud(cloud, grid, sigma) {
    const { positions, count } = cloud;
    const { dims, origin, h, occupancy } = grid;
    const columns = new Float32Array(9);
    const centre = [0, 0, 0];
    const half = [0, 0, 0];
    const radius = [0, 0, 0];
    const box = [0, 0, 0, 0, 0, 0];

    for (let i = 0; i < count; i++) {
        for (let axis = 0; axis < 3; axis++) {
            centre[axis] = positions[i * 3 + axis];
        }

        // Unconditionally, and before anything is tested: the cell holding the
        // centre is material. This is the invariant the render side depends on,
        // and it must not be left to the geometry below -- a Gaussian smaller
        // than a cell can easily miss all nine of that cell's sample points.
        occupancy[cellIndex(grid,
            cellOf(centre[0], origin[0], h, dims[0]),
            cellOf(centre[1], origin[1], h, dims[1]),
            cellOf(centre[2], origin[2], h, dims[2]))] = 1;

        ellipsoidOf(cloud, i, sigma, columns, radius, half);
        for (let axis = 0; axis < 3; axis++) {
            box[axis] = offFace(centre[axis] - half[axis], origin[axis], h, dims[axis]);
            box[axis + 3] = offFace(centre[axis] + half[axis], origin[axis], h, dims[axis]);
        }

        for (let k = box[2]; k <= box[5]; k++) {
            for (let j = box[1]; j <= box[4]; j++) {
                for (let i2 = box[0]; i2 <= box[3]; i2++) {
                    const cell = cellIndex(grid, i2, j, k);
                    if (occupancy[cell] === 0 && cellMeetsEllipsoid(grid, i2, j, k, centre, columns, radius)) {
                        occupancy[cell] = 1;
                    }
                }
            }
        }
    }
}

/**
 * One Gaussian as an ellipsoid: the rotation of its own frame, its half-axes in
 * that frame, and how far it reaches along each world axis.
 *
 * Shared by the two passes that need it -- laying out the grid, and marking
 * cells -- so that the box the grid is built to hold and the box that gets
 * stamped cannot disagree.
 *
 * @param {import('../../assets/splats/cloud.js').SplatCloud} cloud - The Gaussians.
 * @param {number} i - Which one.
 * @param {number} sigma - Standard deviations counted as material.
 * @param {Float32Array} columns - Filled with the column-major rotation.
 * @param {number[]} radius - Filled with the half-axes in the Gaussian's frame.
 * @param {number[]} half - Filled with the reach along each world axis.
 */
function ellipsoidOf(cloud, i, sigma, columns, radius, half) {
    for (let axis = 0; axis < 3; axis++) {
        radius[axis] = sigma * cloud.scales[i * 3 + axis];
    }
    mat3FromQuat(cloud.rotations, i * 4, columns);

    for (let axis = 0; axis < 3; axis++) {
        // Support of the rotated ellipsoid along a world axis: the length of
        // that row of `R * diag(radius)`.
        half[axis] = Math.hypot(
            columns[axis] * radius[0],
            columns[3 + axis] * radius[1],
            columns[6 + axis] * radius[2]
        );
    }
}

/**
 * The box holding every ellipsoid, which is the box the material is in.
 *
 * @param {import('../../assets/splats/cloud.js').SplatCloud} cloud - The Gaussians.
 * @param {number} sigma - Standard deviations counted as material.
 * @returns {{ min: number[], max: number[] }} The bounds.
 */
function materialBounds(cloud, sigma) {
    const columns = new Float32Array(9);
    const radius = [0, 0, 0];
    const half = [0, 0, 0];
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];

    for (let i = 0; i < cloud.count; i++) {
        ellipsoidOf(cloud, i, sigma, columns, radius, half);
        for (let axis = 0; axis < 3; axis++) {
            min[axis] = Math.min(min[axis], cloud.positions[i * 3 + axis] - half[axis]);
            max[axis] = Math.max(max[axis], cloud.positions[i * 3 + axis] + half[axis]);
        }
    }
    return { min, max };
}

/**
 * Whether any of a cell's nine sample points lies inside an ellipsoid.
 *
 * Corners as well as the centre, for the reason `voxelizeSdf` tests corners: a
 * surface that clips a cell near a corner leaves its centre more than half a
 * cell outside, and the cell would be left empty with the geometry still in it.
 *
 * @param {import('./voxelize.js').OccupancyGrid} grid - Grid providing the layout.
 * @param {number} i - Cell index along x.
 * @param {number} j - Cell index along y.
 * @param {number} k - Cell index along z.
 * @param {number[]} centre - Ellipsoid centre in world space.
 * @param {Float32Array} columns - Column-major rotation of the ellipsoid's frame.
 * @param {number[]} radius - Half-axis lengths in that frame.
 * @returns {boolean} Whether the cell holds material.
 */
function cellMeetsEllipsoid(grid, i, j, k, centre, columns, radius) {
    const { origin, h } = grid;

    for (const [ox, oy, oz] of CELL_SAMPLES) {
        const dx = origin[0] + (i + ox) * h - centre[0];
        const dy = origin[1] + (j + oy) * h - centre[1];
        const dz = origin[2] + (k + oz) * h - centre[2];

        let sum = 0;
        for (let axis = 0; axis < 3; axis++) {
            // Column `axis` of the rotation dotted with the offset is that
            // component of the offset in the ellipsoid's own frame.
            const t = (columns[axis * 3] * dx + columns[axis * 3 + 1] * dy + columns[axis * 3 + 2] * dz) /
                radius[axis];
            sum += t * t;
        }
        // A degenerate axis makes `t` infinite or NaN and the test simply fails,
        // which is the right answer: a Gaussian with no thickness encloses
        // nothing. Its centre cell was marked regardless.
        if (sum <= 1) {
            return true;
        }
    }
    return false;
}

/**
 * Turns a stamped shell into a body: thicken until watertight, fill what the
 * outside cannot reach, thin back, and put the shell back on top.
 *
 * The last step is what makes the invariant survive the erosion. Eroding a
 * region that never sealed would eat the shell itself, and with it the cells
 * holding Gaussian centres; OR-ing the stamp back in means the worst this can do
 * is leave the body exactly as porous as it arrived.
 *
 * @param {import('./voxelize.js').OccupancyGrid} grid - Grid to modify in place.
 * @param {number} seal - Cells to thicken by.
 * @returns {number} How many cells the fill turned into material.
 */
function sealAndFill(grid, seal) {
    const stamp = grid.occupancy.slice();

    for (let pass = 0; pass < seal; pass++) {
        grid.occupancy.set(dilated(grid));
    }
    const filled = fillEnclosed(grid);
    for (let pass = 0; pass < seal; pass++) {
        grid.occupancy.set(eroded(grid));
    }

    for (let cell = 0; cell < stamp.length; cell++) {
        grid.occupancy[cell] |= stamp[cell];
    }
    return filled;
}

/**
 * Makes material of every empty cell the outside cannot reach.
 *
 * Flood-fills the empty space inward from the grid's faces through face
 * neighbours only; whatever the flood never arrives at was enclosed.
 *
 * Face neighbours rather than all 26 because a diagonal gap is not a gap the
 * material can be seen through: two cells meeting only at an edge still leave a
 * closed surface between the outside and the inside.
 *
 * @param {import('./voxelize.js').OccupancyGrid} grid - Grid to modify in place.
 * @returns {number} How many cells the fill turned into material.
 */
export function fillEnclosed(grid) {
    const { dims, occupancy } = grid;
    const [nx, ny, nz] = dims;
    const reached = new Uint8Array(occupancy.length);

    // Coordinates rather than linear indices, so nothing here has to unpack an
    // index back into a cell to know whether it is against a face.
    /** @type {number[]} */
    const pending = [];

    /**
     * @param {number} i - Cell index along x.
     * @param {number} j - Cell index along y.
     * @param {number} k - Cell index along z.
     */
    const reach = (i, j, k) => {
        const cell = cellIndex(grid, i, j, k);
        if (occupancy[cell] === 0 && reached[cell] === 0) {
            reached[cell] = 1;
            pending.push(i, j, k);
        }
    };

    for (let k = 0; k < nz; k++) {
        for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) {
                if (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1) {
                    reach(i, j, k);
                }
            }
        }
    }

    while (pending.length > 0) {
        const k = pending.pop();
        const j = pending.pop();
        const i = pending.pop();

        for (const [dx, dy, dz] of NEIGHBOURS) {
            const ni = i + dx, nj = j + dy, nk = k + dz;
            if (ni >= 0 && nj >= 0 && nk >= 0 && ni < nx && nj < ny && nk < nz) {
                reach(ni, nj, nk);
            }
        }
    }

    let filled = 0;
    for (let cell = 0; cell < occupancy.length; cell++) {
        if (occupancy[cell] === 0 && reached[cell] === 0) {
            occupancy[cell] = 1;
            filled++;
        }
    }
    return filled;
}

/**
 * @param {number} value - World coordinate.
 * @param {number} origin - World coordinate of the grid's min corner.
 * @param {number} h - Cell edge length.
 * @param {number} count - Cells along this axis.
 * @returns {number} The cell holding that coordinate, clamped into the grid.
 */
function cellOf(value, origin, h, count) {
    return Math.min(Math.max(Math.floor((value - origin) / h), 0), count - 1);
}

/**
 * @param {number} value - World coordinate.
 * @param {number} origin - World coordinate of the grid's min corner.
 * @param {number} h - Cell edge length.
 * @param {number} count - Cells along this axis.
 * @returns {number} The same, kept one cell inside both faces.
 */
function offFace(value, origin, h, count) {
    return Math.min(Math.max(Math.floor((value - origin) / h), 1), count - 2);
}
