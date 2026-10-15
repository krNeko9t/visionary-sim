/**
 * Turns a shape into a regular occupancy grid -- the input to the lattice
 * builder.
 *
 * Analytic shapes are sampled directly from their SDF, which cannot leak.
 * Triangle meshes go through ray-parity voxelisation cast along all three axes
 * with a majority vote, because the assets are not all watertight: the Stanford
 * bunny has open holes in its base, and a single-axis parity test floods the
 * whole model through them. A hole that defeats one axis rarely defeats two.
 *
 * @typedef {object} OccupancyGrid
 * @property {number[]} dims - Cell counts along each axis.
 * @property {number[]} origin - World position of the min corner of cell (0,0,0).
 * @property {number} h - Cell edge length, in metres.
 * @property {Uint8Array} occupancy - One byte per cell, 1 when material is present.
 */

const DEFAULT_PADDING = 2;

/**
 * Lays out a grid covering `bounds` in cells of edge `elementSize`, plus a ring
 * of empty padding cells.
 *
 * The cell edge *is* the element size the author asked for, not something
 * derived from it, so the same request gives the same cells on a body of any
 * size. An axis whose extent is not a whole number of cells is rounded up: the
 * grid may overhang the material, never fall short of it.
 *
 * The padding is not cosmetic: trilinear embedding needs a full cell of support
 * around every render point, and the morphological close below needs somewhere
 * to grow into.
 *
 * @param {{ min: number[], max: number[] }} bounds - Bounds to cover.
 * @param {object} options - Layout options.
 * @param {number} options.elementSize - Cell edge length, in metres.
 * @param {number} [options.padding] - Empty cells added on every side.
 * @returns {OccupancyGrid} A grid with all cells empty.
 */
export function gridForBounds(bounds, { elementSize, padding = DEFAULT_PADDING } = {}) {
    // No default here: the body has one, and a second one would quietly catch a
    // caller that forgot to pass the size -- or that still passes the old
    // `resolution`, which counted cells rather than measuring them.
    if (!(elementSize > 0 && Number.isFinite(elementSize))) {
        throw new Error(`gridForBounds: elementSize must be a positive length in metres, got ${elementSize}`);
    }
    const h = elementSize;
    const extent = [
        bounds.max[0] - bounds.min[0],
        bounds.max[1] - bounds.min[1],
        bounds.max[2] - bounds.min[2]
    ];

    // The tolerance keeps an extent that is a whole number of cells from
    // rounding up over floating point dust. Mesh vertices are float32, so the
    // dust is up to about 1e-7 of the extent: a model normalised to 0.15 m at
    // 12.5 mm is twelve cells, not thirteen. Short by a millionth of a cell is
    // well inside the padding.
    const dims = extent.map(e => Math.max(1, Math.ceil(e / h - 1e-6)) + 2 * padding);
    const origin = bounds.min.map(v => v - h * padding);

    return {
        dims,
        origin,
        h,
        occupancy: new Uint8Array(dims[0] * dims[1] * dims[2])
    };
}

/**
 * @param {OccupancyGrid} grid - The grid.
 * @param {number} i - Cell index along x.
 * @param {number} j - Cell index along y.
 * @param {number} k - Cell index along z.
 * @returns {number} Linear cell index.
 */
export function cellIndex(grid, i, j, k) {
    return i + grid.dims[0] * (j + grid.dims[1] * k);
}

/**
 * @param {OccupancyGrid} grid - The grid.
 * @returns {number} Number of occupied cells.
 */
export function countOccupied(grid) {
    let count = 0;
    for (let i = 0; i < grid.occupancy.length; i++) {
        count += grid.occupancy[i];
    }
    return count;
}

/**
 * Samples an SDF at cell centres.
 *
 * The thing that must not happen is a cell that holds part of the surface but
 * no material. Its outer nodes then have no mass, so they never move, and a
 * render point embedded there is not merely placed slightly wrong -- the
 * deformation gradient it reads is torn between nodes that moved and nodes that
 * could not, and the surface shades as a black speck. Over-filling by half a
 * cell makes a body marginally larger, which is the cheaper mistake.
 *
 * Two things are needed to guarantee it, and the centre sample alone is neither:
 *
 *   - The grid is offset so cell centres land on the bounds rather than between
 *     them. An axis-aligned face -- every face of a box -- otherwise falls
 *     exactly on the seam between two cells, and the one it gets assigned to is
 *     the empty one.
 *   - A cell counts as material if any of its corners is inside, not only if
 *     its centre is nearly so. A surface that clips a cell near a corner can
 *     leave the centre more than half a cell away.
 *
 * @param {import('../../../../../../apps/simulator/src/assets/shapes.js').Shape} shape - Shape to voxelise.
 * @param {object} options - Layout options, see {@link gridForBounds}.
 * @param {number} options.elementSize - Cell edge length, in metres.
 * @param {number} [options.padding] - Empty cells added on every side.
 * @returns {OccupancyGrid} The filled grid.
 */
export function voxelizeSdf(shape, options = {}) {
    const grid = gridForBounds(shape.bounds, options);
    const { dims, h, occupancy } = grid;
    const origin = grid.origin.map(v => v - h * 0.5);
    grid.origin = origin;
    const threshold = h * 0.5;

    for (let k = 0; k < dims[2]; k++) {
        for (let j = 0; j < dims[1]; j++) {
            for (let i = 0; i < dims[0]; i++) {
                const x = origin[0] + i * h;
                const y = origin[1] + j * h;
                const z = origin[2] + k * h;
                if (shape.sdf(x + h * 0.5, y + h * 0.5, z + h * 0.5) < threshold ||
                    anyCornerInside(shape, x, y, z, h)) {
                    occupancy[cellIndex(grid, i, j, k)] = 1;
                }
            }
        }
    }
    return grid;
}

/**
 * @param {import('../../../../../../apps/simulator/src/assets/shapes.js').Shape} shape - Shape to test against.
 * @param {number} x - Min corner of the cell along x.
 * @param {number} y - Min corner of the cell along y.
 * @param {number} z - Min corner of the cell along z.
 * @param {number} h - Cell edge length.
 * @returns {boolean} Whether any of the eight corners is inside the surface.
 */
function anyCornerInside(shape, x, y, z, h) {
    for (let corner = 0; corner < 8; corner++) {
        const inside = shape.sdf(
            x + (corner & 1 ? h : 0),
            y + (corner & 2 ? h : 0),
            z + (corner & 4 ? h : 0)
        ) < 0;
        if (inside) {
            return true;
        }
    }
    return false;
}

/**
 * Voxelises a triangle mesh by ray-parity along all three axes.
 *
 * @param {import('../../../../../../apps/simulator/src/assets/objLoader.js').TriangleMesh} mesh - Mesh to voxelise.
 * @param {{ min: number[], max: number[] }} bounds - Bounds of the mesh.
 * @param {object} options - Layout options.
 * @param {number} options.elementSize - Cell edge length, in metres.
 * @param {number} [options.padding] - Empty cells added on every side.
 * @param {boolean} [options.close] - Run a morphological close to seal cracks.
 * @returns {OccupancyGrid} The filled grid.
 */
export function voxelizeMesh(mesh, bounds, options = {}) {
    const { close = true } = options;
    const grid = gridForBounds(bounds, options);
    const cellCount = grid.occupancy.length;

    // How many of the three axes call each cell interior, and which cells the
    // surface itself passes through.
    const votes = new Uint8Array(cellCount);
    const surface = new Uint8Array(cellCount);

    for (let axis = 0; axis < 3; axis++) {
        accumulateAxis(mesh, grid, axis, votes, surface);
    }
    markEdgeCells(mesh, grid, surface);

    for (let c = 0; c < cellCount; c++) {
        grid.occupancy[c] = votes[c] >= 2 || surface[c] === 1 ? 1 : 0;
    }

    if (close) {
        morphologicalClose(grid);
    }
    return grid;
}

/**
 * Marks every cell touched by a triangle edge.
 *
 * The column rays above sample at cell centres, so a triangle that only clips
 * the corner of a cell leaves it unmarked -- and any render vertex there would
 * end up embedded in inactive nodes and tear off the body. Walking the edges fixes
 * that at the vertices exactly (they are edge endpoints) and covers the rest of
 * the silhouette on the way.
 *
 * @param {import('../../../../../../apps/simulator/src/assets/objLoader.js').TriangleMesh} mesh - Mesh to sample.
 * @param {OccupancyGrid} grid - Target grid.
 * @param {Uint8Array} surface - Per-cell surface flag, accumulated.
 */
function markEdgeCells(mesh, grid, surface) {
    const { dims, origin, h } = grid;
    const { positions, indices } = mesh;
    // Sub-cell stepping, so consecutive samples land in the same or an
    // adjacent cell rather than stepping over one.
    const step = h * 0.4;

    /**
     * @param {number} x - World x.
     * @param {number} y - World y.
     * @param {number} z - World z.
     */
    const mark = (x, y, z) => {
        const i = Math.floor((x - origin[0]) / h);
        const j = Math.floor((y - origin[1]) / h);
        const k = Math.floor((z - origin[2]) / h);
        if (i >= 0 && j >= 0 && k >= 0 && i < dims[0] && j < dims[1] && k < dims[2]) {
            surface[cellIndex(grid, i, j, k)] = 1;
        }
    };

    for (let t = 0; t < indices.length; t += 3) {
        for (let e = 0; e < 3; e++) {
            const a = indices[t + e] * 3;
            const b = indices[t + ((e + 1) % 3)] * 3;
            const dx = positions[b] - positions[a];
            const dy = positions[b + 1] - positions[a + 1];
            const dz = positions[b + 2] - positions[a + 2];

            const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy, dz) / step));
            for (let s = 0; s <= steps; s++) {
                const f = s / steps;
                mark(positions[a] + dx * f, positions[a + 1] + dy * f, positions[a + 2] + dz * f);
            }
        }
    }
}

/**
 * Casts one ray per cell column along `axis`, recording where the surface is
 * crossed. Cells past an odd number of crossings are interior.
 *
 * The three axes share this code through an index permutation rather than three
 * near-identical loops.
 *
 * @param {import('../../../../../../apps/simulator/src/assets/objLoader.js').TriangleMesh} mesh - Mesh to sample.
 * @param {OccupancyGrid} grid - Target grid.
 * @param {number} axis - Ray direction, 0/1/2 for x/y/z.
 * @param {Uint8Array} votes - Per-cell interior vote count, accumulated.
 * @param {Uint8Array} surface - Per-cell surface flag, accumulated.
 */
function accumulateAxis(mesh, grid, axis, votes, surface) {
    const { dims, origin, h } = grid;
    const { positions, indices } = mesh;

    // Ray runs along `w`; columns are indexed by (u, v).
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    const w = axis;

    const columnCount = dims[u] * dims[v];
    /** @type {number[][]} */
    const crossings = Array.from({ length: columnCount }, () => []);

    // Sampling exactly at cell centres would put rays through shared triangle
    // edges on an axis-aligned mesh, which double-counts or misses crossings.
    // A fixed sub-cell offset keeps the result deterministic and off the seams.
    const jitterU = h * 1.7e-4;
    const jitterV = h * 0.9e-4;

    for (let t = 0; t < indices.length; t += 3) {
        const a = indices[t] * 3;
        const b = indices[t + 1] * 3;
        const c = indices[t + 2] * 3;

        const au = positions[a + u], av = positions[a + v], aw = positions[a + w];
        const bu = positions[b + u], bv = positions[b + v], bw = positions[b + w];
        const cu = positions[c + u], cv = positions[c + v], cw = positions[c + w];

        const area2 = (bv - cv) * (au - cu) + (cu - bu) * (av - cv);
        if (Math.abs(area2) < 1e-20) {
            continue; // Degenerate when seen along this axis.
        }
        const invArea2 = 1 / area2;

        // Columns whose sample point can fall inside this triangle.
        const minU = Math.min(au, bu, cu);
        const maxU = Math.max(au, bu, cu);
        const minV = Math.min(av, bv, cv);
        const maxV = Math.max(av, bv, cv);

        const a0 = Math.max(0, Math.ceil((minU - origin[u]) / h - 0.5));
        const a1 = Math.min(dims[u] - 1, Math.floor((maxU - origin[u]) / h - 0.5));
        const b0 = Math.max(0, Math.ceil((minV - origin[v]) / h - 0.5));
        const b1 = Math.min(dims[v] - 1, Math.floor((maxV - origin[v]) / h - 0.5));

        for (let cv2 = b0; cv2 <= b1; cv2++) {
            const pv = origin[v] + (cv2 + 0.5) * h + jitterV;
            for (let cu2 = a0; cu2 <= a1; cu2++) {
                const pu = origin[u] + (cu2 + 0.5) * h + jitterU;

                const l0 = ((bv - cv) * (pu - cu) + (cu - bu) * (pv - cv)) * invArea2;
                if (l0 < 0) continue;
                const l1 = ((cv - av) * (pu - cu) + (au - cu) * (pv - cv)) * invArea2;
                if (l1 < 0) continue;
                const l2 = 1 - l0 - l1;
                if (l2 < 0) continue;

                crossings[cu2 + dims[u] * cv2].push(l0 * aw + l1 * bw + l2 * cw);
            }
        }
    }

    const ijk = [0, 0, 0];
    for (let cv2 = 0; cv2 < dims[v]; cv2++) {
        for (let cu2 = 0; cu2 < dims[u]; cu2++) {
            const hits = crossings[cu2 + dims[u] * cv2];
            if (hits.length === 0) {
                continue;
            }
            hits.sort((p, q) => p - q);

            ijk[u] = cu2;
            ijk[v] = cv2;

            // Every crossing lands in some cell: that cell holds surface.
            for (const hit of hits) {
                const cw = Math.floor((hit - origin[w]) / h);
                if (cw >= 0 && cw < dims[w]) {
                    ijk[w] = cw;
                    surface[cellIndex(grid, ijk[0], ijk[1], ijk[2])] = 1;
                }
            }

            // Walk the column, flipping parity at each crossing behind us.
            let next = 0;
            let inside = false;
            for (let cw = 0; cw < dims[w]; cw++) {
                const centre = origin[w] + (cw + 0.5) * h;
                while (next < hits.length && hits[next] <= centre) {
                    inside = !inside;
                    next++;
                }
                if (inside) {
                    ijk[w] = cw;
                    votes[cellIndex(grid, ijk[0], ijk[1], ijk[2])]++;
                }
            }
        }
    }
}

/**
 * Grows the occupied region by one cell in each of the six directions.
 *
 * @param {OccupancyGrid} grid - Grid providing the dimensions.
 * @param {Uint8Array} [source] - Occupancy to grow; the grid's own by default.
 * @returns {Uint8Array} The result; the input is untouched.
 */
export function dilated(grid, source = grid.occupancy) {
    return neighbourhoodPass(grid, source, true);
}

/**
 * Shrinks the occupied region by one cell in each of the six directions.
 *
 * @param {OccupancyGrid} grid - Grid providing the dimensions.
 * @param {Uint8Array} [source] - Occupancy to shrink; the grid's own by default.
 * @returns {Uint8Array} The result; the input is untouched.
 */
export function eroded(grid, source = grid.occupancy) {
    return neighbourhoodPass(grid, source, false);
}

/**
 * Dilate then erode with a 6-neighbourhood, sealing pits and cracks up to one
 * cell wide without changing the bulk of the body.
 *
 * @param {OccupancyGrid} grid - Grid to modify in place.
 */
export function morphologicalClose(grid) {
    grid.occupancy.set(eroded(grid, dilated(grid)));
}

/**
 * @param {OccupancyGrid} grid - Grid providing the dimensions.
 * @param {Uint8Array} source - Input occupancy.
 * @param {boolean} dilate - True to dilate, false to erode.
 * @returns {Uint8Array} The result.
 */
function neighbourhoodPass(grid, source, dilate) {
    const [nx, ny, nz] = grid.dims;
    const out = new Uint8Array(source.length);

    for (let k = 0; k < nz; k++) {
        for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) {
                const index = i + nx * (j + ny * k);
                // Dilate only has work to do on a clear cell, erode only on a
                // set one; in both cases that is `result !== dilate`, and the
                // first triggering neighbour settles the answer.
                let result = source[index] === 1;

                for (let axis = 0; axis < 3 && result !== dilate; axis++) {
                    for (let step = -1; step <= 1; step += 2) {
                        const ni = i + (axis === 0 ? step : 0);
                        const nj = j + (axis === 1 ? step : 0);
                        const nk = k + (axis === 2 ? step : 0);
                        // Outside the grid counts as empty in both passes; the
                        // padding ring guarantees that is the truth.
                        const outside = ni < 0 || nj < 0 || nk < 0 || ni >= nx || nj >= ny || nk >= nz;
                        const neighbour = outside ? 0 : source[ni + nx * (nj + ny * nk)];
                        if (dilate ? neighbour === 1 : neighbour === 0) {
                            result = dilate;
                            break;
                        }
                    }
                }
                out[index] = result ? 1 : 0;
            }
        }
    }
    return out;
}
