/**
 * Analytic shapes as signed distance functions.
 *
 * Voxelising an SDF is exact and cannot leak, unlike ray-parity voxelisation of
 * a triangle soup, so the analytic bodies (torus, sphere, cube) take this path
 * instead of being tessellated first and voxelised after.
 *
 * @typedef {object} Shape
 * @property {(x: number, y: number, z: number) => number} sdf - Signed distance, negative inside.
 * @property {{ min: number[], max: number[] }} bounds - Axis-aligned bounds of the surface.
 */

/**
 * A torus lying in the XZ plane, centred on the origin.
 *
 * @param {object} options - Shape options.
 * @param {number} options.majorRadius - Distance from centre to tube centre.
 * @param {number} options.minorRadius - Tube radius.
 * @returns {Shape} The shape.
 */
export function torus({ majorRadius, minorRadius }) {
    const outer = majorRadius + minorRadius;
    return {
        bounds: {
            min: [-outer, -minorRadius, -outer],
            max: [outer, minorRadius, outer]
        },
        sdf: (x, y, z) => {
            const radial = Math.hypot(x, z) - majorRadius;
            return Math.hypot(radial, y) - minorRadius;
        }
    };
}

/**
 * @param {object} options - Shape options.
 * @param {number} options.radius - Sphere radius.
 * @returns {Shape} The shape.
 */
export function sphere({ radius }) {
    return {
        bounds: {
            min: [-radius, -radius, -radius],
            max: [radius, radius, radius]
        },
        sdf: (x, y, z) => Math.hypot(x, y, z) - radius
    };
}

/**
 * @param {object} options - Shape options.
 * @param {number[]} options.halfExtents - Half size along each axis.
 * @returns {Shape} The shape.
 */
export function box({ halfExtents }) {
    const [hx, hy, hz] = halfExtents;
    return {
        bounds: {
            min: [-hx, -hy, -hz],
            max: [hx, hy, hz]
        },
        sdf: (x, y, z) => {
            const dx = Math.abs(x) - hx;
            const dy = Math.abs(y) - hy;
            const dz = Math.abs(z) - hz;
            const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0), Math.max(dz, 0));
            const inside = Math.min(Math.max(dx, dy, dz), 0);
            return outside + inside;
        }
    };
}

/**
 * @param {Shape} shape - Shape to move.
 * @param {number[]} offset - Translation to apply.
 * @returns {Shape} The translated shape.
 */
export function translateShape(shape, offset) {
    const [dx, dy, dz] = offset;
    return {
        bounds: {
            min: [shape.bounds.min[0] + dx, shape.bounds.min[1] + dy, shape.bounds.min[2] + dz],
            max: [shape.bounds.max[0] + dx, shape.bounds.max[1] + dy, shape.bounds.max[2] + dz]
        },
        sdf: (x, y, z) => shape.sdf(x - dx, y - dy, z - dz)
    };
}

/**
 * Shifts a shape so its lowest point sits at `y = 0`, matching the convention
 * `normalizeMesh` applies to loaded meshes.
 *
 * @param {Shape} shape - Shape to lift.
 * @returns {Shape} A shape resting on the ground plane.
 */
export function restOnGround(shape) {
    return translateShape(shape, [0, -shape.bounds.min[1], 0]);
}
