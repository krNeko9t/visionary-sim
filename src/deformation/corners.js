/**
 * The one convention the simulation side and the render side must agree on:
 * how the eight corners of a cell are numbered.
 *
 * It lives here, in the channel, rather than on either side, because it is
 * exactly what makes the two sides able to talk without knowing each other.
 * The simulation lays out its degrees of freedom in this order; the sampler
 * weighs them in this order; the WGSL on both sides derives it arithmetically
 * from the same rule.
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
