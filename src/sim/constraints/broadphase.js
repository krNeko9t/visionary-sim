/**
 * How contact narrows millions of possible pairs down to a few hundred real
 * ones.
 *
 * A uniform grid, and deliberately nothing cleverer. The textbook answer for
 * this problem is a bounding volume hierarchy, and it is the right answer when
 * you have thousands of arbitrary convex shapes to sort out. Here there are
 * five soft bodies in a known box, all of the candidates are points, and the
 * points move every substep -- which is exactly the case a tree is worst at,
 * because it has to be rebuilt or refitted each time while a grid is simply
 * refilled. Sorting the points is not needed either: a bucket holds a fixed
 * handful and drops the rest, so there is no prefix sum and no allocation.
 *
 * The grid lives in world space over the tank, not in any body's rest space.
 * Each body already carries an occupancy grid, but it is a rest-space one:
 * asking it "what is near this deformed point" would first need the
 * deformation inverted, which is the one thing nobody can afford per node per
 * substep. Refilling a world grid is cheaper than that inversion.
 *
 * The layout is separate from the kernels that use it (`bodyContact.js`) for
 * the same reason `compliance.js` is separate from `elasticCells.js`: this part
 * is arithmetic that can be reasoned about and tested, and the other part is
 * buffers and dispatches that cannot.
 */

/**
 * Lays out the grid over the region contacts can happen in.
 *
 * One bucket is one contact diameter across. That is what makes the twenty-
 * seven buckets around a node enough to hold everything that could touch it,
 * and it is the only thing the search radius in the kernel depends on. A ring
 * of margin buckets is added so a body resting against a wall is still indexed
 * rather than clamped.
 *
 * A scene with nothing in it offers no contact diameter, and so no bucket size.
 * That case is real -- a scene can be all backdrop and no bodies -- so it is
 * answered here rather than left to fall through: dividing by zero makes the
 * grid infinitely fine, and the symptom is WebGPU refusing a buffer of infinite
 * length, a long way from anything that mentions bodies. One bucket spanning the
 * whole region is as arbitrary as it looks; nothing is ever binned into it.
 *
 * @param {{ min: number[], max: number[] }} bounds - Region to cover.
 * @param {number} cell - Bucket edge length: the largest contact diameter.
 * @returns {{ origin: number[], cell: number, dims: number[], bucketCount: number }} The layout.
 */
export function broadphaseGrid(bounds, cell) {
    const edge = cell > 0
        ? cell
        : Math.max(...bounds.min.map((min, axis) => bounds.max[axis] - min));
    const dims = bounds.min.map((min, axis) =>
        Math.max(1, Math.ceil((bounds.max[axis] - min) / edge)) + 2);
    return {
        origin: bounds.min.map(min => min - edge),
        cell: edge,
        dims,
        bucketCount: dims[0] * dims[1] * dims[2]
    };
}

/**
 * Upper bound on how many of one body's own nodes could ever land in a
 * single bucket, given its own node spacing.
 *
 * A hard bound, not a probabilistic guess: nodes on a lattice are never
 * closer together than `h`, so an axis-aligned cube of edge `cell` can never
 * contain more than `ceil(cell / h) + 1` of them along any one axis. The cell
 * size is set from the coarsest body in the scene (`bodyContact.js`), so a
 * much finer body sharing it can pack far more than a coarse body's own ~1
 * node per bucket -- this is what lets `bodyContact.js` warn about that
 * before the resulting bucket overflow becomes routine instead of rare.
 *
 * @param {number} cell - Bucket edge length.
 * @param {number} h - The body's own node spacing.
 * @returns {number} Worst-case node count in one bucket.
 */
export function worstCaseBucketOccupancy(cell, h) {
    const perAxis = Math.ceil(cell / h) + 1;
    return perAxis ** 3;
}

/**
 * Which bucket a world point falls in.
 *
 * The clamp is the same one `gridCoord` applies in `wgsl/contacts.wgsl`, and
 * for the same reason: a point outside the grid still has to be given a bucket,
 * because rejecting it would mean every caller needed a second answer ready. It
 * cannot invent a contact, since the narrow phase measures the real distance
 * whichever bucket a pair was found in.
 *
 * @param {{ origin: number[], cell: number, dims: number[] }} grid - The layout.
 * @param {number[]} point - World position.
 * @returns {number} Linear bucket index.
 */
export function bucketOf(grid, point) {
    let index = 0;
    for (let axis = 2; axis >= 0; axis--) {
        const raw = Math.floor((point[axis] - grid.origin[axis]) / grid.cell);
        index = index * grid.dims[axis] + Math.min(grid.dims[axis] - 1, Math.max(0, raw));
    }
    return index;
}
