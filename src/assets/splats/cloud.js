import { readPly } from './ply.js';

/**
 * A Gaussian cloud as the rest of the system wants it: SI units, activated
 * values, one flat array per quantity.
 *
 * The file's own encoding -- log-space scale, pre-sigmoid opacity, degree-0
 * spherical harmonics standing in for colour -- is undone here and nowhere
 * else. Downstream, "scale" is metres and "opacity" is a number between 0 and
 * 1, which is what makes it possible to filter on either without every caller
 * re-deriving the same two transcendentals.
 *
 * Spherical harmonics above the constant term are dropped. That is a decision,
 * not an oversight: under deformation the view-dependent lobes would have to be
 * rotated with the material and they are not, so keeping them would buy
 * highlights that point the wrong way as soon as the body moves. The cost is a
 * slightly flatter look than a plain viewer gives, and the bands can be carried
 * through later if that turns out to matter.
 *
 * @typedef {object} SplatCloud
 * @property {number} count - Number of Gaussians.
 * @property {Float32Array} positions - Centres, 3 per splat, in metres.
 * @property {Float32Array} rotations - Unit quaternions, 4 per splat as xyzw.
 * @property {Float32Array} scales - Standard deviations, 3 per splat, in metres.
 * @property {Float32Array} opacity - Coverage in [0, 1], 1 per splat.
 * @property {Float32Array} colors - Linear RGB, 3 per splat.
 */

/** Degree-0 spherical harmonic, the constant that turns `f_dc` into colour. */
const SH_C0 = 0.28209479177387814;

/** The properties a 3DGS PLY must carry for any of this to mean anything. */
export const REQUIRED_PROPERTIES = [
    'x', 'y', 'z',
    'f_dc_0', 'f_dc_1', 'f_dc_2',
    'opacity',
    'scale_0', 'scale_1', 'scale_2',
    'rot_0', 'rot_1', 'rot_2', 'rot_3'
];

/**
 * @param {string} url - URL of a binary 3DGS PLY.
 * @returns {Promise<SplatCloud>} The cloud, in metres-per-file-unit and activated.
 */
export async function loadCloud(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }
    return cloudFromPly(readPly(await response.arrayBuffer(), { properties: REQUIRED_PROPERTIES }));
}

/**
 * @param {import('./ply.js').PlyElement} ply - A PLY element holding splats.
 * @returns {SplatCloud} The cloud.
 */
export function cloudFromPly({ count, properties }) {
    const p = properties;
    const positions = new Float32Array(count * 3);
    const rotations = new Float32Array(count * 4);
    const scales = new Float32Array(count * 3);
    const opacity = new Float32Array(count);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
        positions[i * 3] = p.x[i];
        positions[i * 3 + 1] = p.y[i];
        positions[i * 3 + 2] = p.z[i];

        scales[i * 3] = Math.exp(p.scale_0[i]);
        scales[i * 3 + 1] = Math.exp(p.scale_1[i]);
        scales[i * 3 + 2] = Math.exp(p.scale_2[i]);

        opacity[i] = sigmoid(p.opacity[i]);

        colors[i * 3] = p.f_dc_0[i] * SH_C0 + 0.5;
        colors[i * 3 + 1] = p.f_dc_1[i] * SH_C0 + 0.5;
        colors[i * 3 + 2] = p.f_dc_2[i] * SH_C0 + 0.5;

        // The file stores `rot_0` as the real part; everything here and
        // downstream uses xyzw, so the reordering happens once, at the door.
        writeUnitQuat(rotations, i, p.rot_1[i], p.rot_2[i], p.rot_3[i], p.rot_0[i]);
    }

    return { count, positions, rotations, scales, opacity, colors };
}

/**
 * Writes a normalised quaternion with a non-negative real part.
 *
 * Both halves matter. Training leaves the quaternions unnormalised, so a raw
 * one is not a rotation at all; and `q` and `-q` are the same rotation, so
 * pinning the sign keeps any later comparison or interpolation from flipping.
 * A degenerate quaternion becomes the identity rather than a NaN, because one
 * bad splat in a hundred thousand should not poison a bounding box.
 *
 * @param {Float32Array} out - Destination, 4 floats per splat.
 * @param {number} i - Splat index.
 * @param {number} x - Imaginary x.
 * @param {number} y - Imaginary y.
 * @param {number} z - Imaginary z.
 * @param {number} w - Real part.
 */
export function writeUnitQuat(out, i, x, y, z, w) {
    const length = Math.hypot(x, y, z, w);
    const sign = w < 0 ? -1 : 1;
    const scale = length > 0 ? sign / length : 0;

    out[i * 4] = x * scale;
    out[i * 4 + 1] = y * scale;
    out[i * 4 + 2] = z * scale;
    out[i * 4 + 3] = length > 0 ? w * scale : 1;
}

/**
 * @param {number} v - Pre-sigmoid value.
 * @returns {number} `1 / (1 + exp(-v))`, computed so large negatives do not overflow.
 */
function sigmoid(v) {
    if (v >= 0) {
        return 1 / (1 + Math.exp(-v));
    }
    const t = Math.exp(v);
    return t / (1 + t);
}
