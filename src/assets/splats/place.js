import { robustBounds, sizeOf } from './measure.js';

/**
 * Putting a capture into the world: which way is up, how big it is, where it
 * stands.
 *
 * None of the three can be read out of the file. A 3DGS PLY carries no units
 * and no up axis -- the trainer wrote whatever frame the reconstruction landed
 * in -- so all three are declared by whoever puts the asset in a scene, and
 * `measure.js` exists so that the declaration can be checked against the thing
 * instead of guessed at. The two assets in this repository disagree with each
 * other, which is the whole argument for not hard-coding one answer.
 *
 * The result matches `normalizeMesh` exactly: longest axis at the requested
 * size, base on y = 0, centred in x and z, then moved to `position`. A splat
 * body and a mesh body are therefore placed by the same rule, and the rest of
 * the system keeps its assumption that a body's rest shape is already in world
 * space.
 */

/**
 * Named source frames, as the rotation that carries them to y-up.
 *
 * Stored as quaternions rather than matrices so that positions and splat
 * rotations cannot drift apart: both are rotated by this one value.
 *
 * @type {Record<string, number[]>}
 */
export const CONVENTIONS = {
    /** Already y-up. Most viewers, and `bread.ply`. */
    'y-up': [0, 0, 0, 1],
    /** z-up, y into the scene -- Blender, COLMAP world frames, and `wolf.ply`. */
    'z-up': [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
    /** y-down, z forward -- the OpenCV camera frame raw 3DGS output often keeps. */
    'y-down': [1, 0, 0, 0]
};

/**
 * Rotates a cloud from a named source frame into y-up, in place.
 *
 * Scales are untouched: they are the lengths of the Gaussian's own axes, and a
 * rotation does not change a length. Only where each Gaussian sits and which
 * way it points move.
 *
 * @param {import('./cloud.js').SplatCloud} cloud - Modified in place.
 * @param {string} convention - A key of {@link CONVENTIONS}.
 * @returns {import('./cloud.js').SplatCloud} The same cloud, for chaining.
 */
export function orientCloud(cloud, convention) {
    const q = CONVENTIONS[convention];
    if (!q) {
        throw new Error(`unknown splat convention "${convention}"; known: ${Object.keys(CONVENTIONS).join(', ')}`);
    }
    if (convention === 'y-up') {
        return cloud;
    }

    const { positions, rotations, count } = cloud;
    for (let i = 0; i < count; i++) {
        rotatePoint(q, positions, i * 3);
        composeQuat(q, rotations, i * 4);
    }
    return cloud;
}

/**
 * Scales a cloud to a size and stands it at a position, in place.
 *
 * Expects a cloud that is already y-up and already cleaned: which axis is the
 * longest depends on the first, and how long it is depends on the second.
 * {@link import('./capture.js').loadCapture} is what puts the three in order.
 *
 * @param {import('./cloud.js').SplatCloud} cloud - Modified in place.
 * @param {object} options - Placement.
 * @param {number} options.size - Size of the longest axis afterwards, in metres.
 * @param {number[]} options.position - Where the base of the cloud ends up.
 * @returns {{ scale: number, extent: number[] }} What was applied, and the
 *   final extent -- worth reporting, because it is the first number that says
 *   whether the declared convention and size were the right ones.
 */
export function placeCloud(cloud, { size, position }) {
    // Trimmed rather than raw, for the same reason `measure.js` trims: a size
    // taken from junk is not a size.
    const bounds = robustBounds(cloud);
    const extent = sizeOf(bounds);
    const scale = size / Math.max(extent[0], extent[1], extent[2]);

    const centreX = (bounds.min[0] + bounds.max[0]) * 0.5;
    const centreZ = (bounds.min[2] + bounds.max[2]) * 0.5;

    const { positions, scales, count } = cloud;
    for (let i = 0; i < count; i++) {
        positions[i * 3] = (positions[i * 3] - centreX) * scale + position[0];
        positions[i * 3 + 1] = (positions[i * 3 + 1] - bounds.min[1]) * scale + position[1];
        positions[i * 3 + 2] = (positions[i * 3 + 2] - centreZ) * scale + position[2];

        // A Gaussian's extent is a length in the same space, so it scales too.
        // Forgetting this is not subtle: the splats stay their original size
        // and the body renders as a cloud of boulders.
        scales[i * 3] *= scale;
        scales[i * 3 + 1] *= scale;
        scales[i * 3 + 2] *= scale;
    }

    return { scale, extent: extent.map(v => v * scale) };
}

/**
 * @param {number[]} q - Unit quaternion, xyzw.
 * @param {Float32Array} out - Array holding a 3-vector at `at`, modified in place.
 * @param {number} at - Index of the vector's first component.
 */
function rotatePoint(q, out, at) {
    const [qx, qy, qz, qw] = q;
    const x = out[at], y = out[at + 1], z = out[at + 2];

    // v + 2 * q_v x (q_v x v + w v), the cross-product form: no matrix, and no
    // chance of a transposed one.
    const tx = 2 * (qy * z - qz * y);
    const ty = 2 * (qz * x - qx * z);
    const tz = 2 * (qx * y - qy * x);

    out[at] = x + qw * tx + qy * tz - qz * ty;
    out[at + 1] = y + qw * ty + qz * tx - qx * tz;
    out[at + 2] = z + qw * tz + qx * ty - qy * tx;
}

/**
 * Left-multiplies the quaternion at `at` by `q`.
 *
 * @param {number[]} q - Unit quaternion, xyzw.
 * @param {Float32Array} out - Array holding a quaternion at `at`, modified in place.
 * @param {number} at - Index of the quaternion's first component.
 */
function composeQuat(q, out, at) {
    const [ax, ay, az, aw] = q;
    const bx = out[at], by = out[at + 1], bz = out[at + 2], bw = out[at + 3];

    out[at] = aw * bx + ax * bw + ay * bz - az * by;
    out[at + 1] = aw * by - ax * bz + ay * bw + az * bx;
    out[at + 2] = aw * bz + ax * by - ay * bx + az * bw;
    out[at + 3] = aw * bw - ax * bx - ay * by - az * bz;
}
