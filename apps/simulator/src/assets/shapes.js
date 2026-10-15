import { translateMesh } from './objLoader.js';
import { joinPatches, patch } from './tessellate.js';

/**
 * Analytic shapes: a distance function for the simulator, a surface for the
 * renderer.
 *
 * Filling a proxy geometry from an SDF is exact and cannot leak -- inside is
 * the sign of one number, not a ray-parity count over a triangle soup -- so the
 * analytic bodies (torus, sphere, cube) are simulated from the distance
 * function and never from their triangles. The surface exists
 * only because something has to be drawn; it is the shape's own parametrisation
 * rather than an extraction from the SDF, so it lands exactly on the zero level
 * set at any resolution.
 *
 * @typedef {import('visionary-sim/body/restGeometry.js').Shape &
 *   { surface: import('visionary-sim/body/restGeometry.js').TriangleMesh }} Shape
 */

/** Cyclic axis triples, so a box face can be built from its normal's axis. */
const AXIS_CYCLE = [[0, 1, 2], [1, 2, 0], [2, 0, 1]];

/**
 * A torus lying in the XZ plane, centred on the origin.
 *
 * @param {object} options - Shape options.
 * @param {number} options.majorRadius - Distance from centre to tube centre.
 * @param {number} options.minorRadius - Tube radius.
 * @param {number[]} [options.segments] - Quads around the tube and around the ring.
 * @returns {Shape} The shape.
 */
export function torus({ majorRadius, minorRadius, segments = [18, 44] }) {
    const outer = majorRadius + minorRadius;
    return {
        bounds: {
            min: [-outer, -minorRadius, -outer],
            max: [outer, minorRadius, outer]
        },
        sdf: (x, y, z) => {
            const radial = Math.hypot(x, z) - majorRadius;
            return Math.hypot(radial, y) - minorRadius;
        },
        // u runs around the tube and v around the ring, in that order because
        // the reverse would face every triangle inwards.
        surface: patch(segments[0], segments[1], (u, v) => {
            const tube = u * 2 * Math.PI;
            const ring = v * 2 * Math.PI;
            const radius = majorRadius + minorRadius * Math.cos(tube);
            return [radius * Math.cos(ring), minorRadius * Math.sin(tube), radius * Math.sin(ring)];
        }, { wrapU: true, wrapV: true })
    };
}

/**
 * @param {object} options - Shape options.
 * @param {number} options.radius - Sphere radius.
 * @param {number[]} [options.segments] - Quads around the equator and pole to pole.
 * @returns {Shape} The shape.
 */
export function sphere({ radius, segments = [32, 16] }) {
    return {
        bounds: {
            min: [-radius, -radius, -radius],
            max: [radius, radius, radius]
        },
        sdf: (x, y, z) => Math.hypot(x, y, z) - radius,
        surface: patch(segments[0], segments[1], (u, v) => {
            const azimuth = u * 2 * Math.PI;
            const height = Math.cos(v * Math.PI);
            // The ring radius comes from the height rather than from sin, so
            // that both poles close to exactly zero and `patch` can see that
            // those rows are each a single point.
            const ring = Math.sqrt(Math.max(0, 1 - height * height));
            return [
                radius * ring * Math.cos(azimuth),
                radius * height,
                radius * ring * Math.sin(azimuth)
            ];
        }, { wrapU: true })
    };
}

/**
 * @param {object} options - Shape options.
 * @param {number[]} options.halfExtents - Half size along each axis.
 * @param {number} [options.segments] - Quads along each edge of each face.
 * @returns {Shape} The shape.
 */
export function box({ halfExtents, segments = 6 }) {
    const [hx, hy, hz] = halfExtents;
    const faces = [];
    for (let axis = 0; axis < 3; axis++) {
        for (const sign of [1, -1]) {
            faces.push(boxFace(halfExtents, axis, sign, segments));
        }
    }

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
        },
        // Six patches rather than one welded box: nothing is shared across an
        // edge, so the edges shade sharp instead of being rounded off by
        // averaged normals.
        surface: joinPatches(faces)
    };
}

/**
 * One face of a box. Subdivided rather than left as two triangles, because a
 * face carried by the deformation field has to be able to bend.
 *
 * @param {number[]} halfExtents - Half size along each axis.
 * @param {number} axis - Axis the face faces along.
 * @param {number} sign - Which end of that axis.
 * @param {number} segments - Quads along each edge.
 * @returns {import('./objLoader.js').TriangleMesh} The face.
 */
function boxFace(halfExtents, axis, sign, segments) {
    const [normal, next, last] = AXIS_CYCLE[axis];
    // Swapping the two in-plane axes for the far face is what keeps du x dv
    // pointing outwards on both ends.
    const [uAxis, vAxis] = sign > 0 ? [next, last] : [last, next];

    return patch(segments, segments, (u, v) => {
        const point = [0, 0, 0];
        point[normal] = sign * halfExtents[normal];
        point[uAxis] = (u * 2 - 1) * halfExtents[uAxis];
        point[vAxis] = (v * 2 - 1) * halfExtents[vAxis];
        return point;
    });
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
        sdf: (x, y, z) => shape.sdf(x - dx, y - dy, z - dz),
        surface: {
            positions: translateMesh(Float32Array.from(shape.surface.positions), offset),
            indices: shape.surface.indices
        }
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
