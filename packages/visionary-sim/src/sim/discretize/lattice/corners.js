/**
 * How the eight corners of a cell are numbered.
 *
 * Everything in this directory that walks a cell's corners agrees on this
 * order: the lattice lumps mass onto its corners by it, the Kuhn split names
 * its tetrahedra by it, the sampler weighs corners by it, and the WGSL -- the
 * sampler's and the elastic constraint's -- derives it arithmetically from the
 * same rule.
 */

/** Corner offsets of the unit cell, indexed so corner `c` is `(c&1, (c>>1)&1, (c>>2)&1)`. */
export const CUBE_CORNERS = Object.freeze([
    [0, 0, 0], // 0
    [1, 0, 0], // 1
    [0, 1, 0], // 2
    [1, 1, 0], // 3
    [0, 0, 1], // 4
    [1, 0, 1], // 5
    [0, 1, 1], // 6
    [1, 1, 1] //  7
]);
