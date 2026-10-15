import { CUBE_CORNERS } from './corners.js';

// Include all diagonals: limiting only axis edges lets a sheared cell become
// arbitrarily long along a diagonal. Lengths are for a unit rest cell.
export const STRETCH_EDGES = CUBE_CORNERS.flatMap((a, i) =>
    CUBE_CORNERS.slice(i + 1).map((b, j) =>
        [i, i + j + 1, Math.hypot(...a.map((v, axis) => v - b[axis]))]));

/**
 * CPU reference for the unilateral length projection in project.wgsl.
 * Add wa * correction to a and subtract wb * correction from b. Prescribed
 * endpoints carry zero weight; two prescribed endpoints cannot be corrected.
 * This is a tension limit, not a spring to a world-space rest position.
 * @param {number[]} a - First position.
 * @param {number[]} b - Second position.
 * @param {number} wa - First inverse mass.
 * @param {number} wb - Second inverse mass.
 * @param {number} maximum - Maximum separation in metres.
 * @returns {number[]} Correction before inverse-mass weighting.
 */
export function stretchCorrection(a, b, wa, wb, maximum) {
    const d = b.map((v, axis) => v - a[axis]);
    const length = Math.hypot(...d);
    if (wa + wb === 0 || length <= maximum || length === 0) return [0, 0, 0];
    const scale = (length - maximum) / (length * (wa + wb));
    return d.map(v => v * scale);
}
