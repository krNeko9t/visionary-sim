import covarianceWgsl from './covariance.wgsl?raw';
import sampleWgsl from './sample.wgsl?raw';

/**
 * The one way a material reads the deformation.
 *
 * There is exactly one implementation of this because the dependency rules
 * leave nowhere else to put it: a render path may reach only `deformation/`,
 * the debug view may reach only `sim/discretize/` and `deformation/`, so the
 * single place both can see is here. Anything that wanted its own copy would
 * have to break the layering to get one.
 *
 * A consumer needs two halves and both come from this file, which is what keeps
 * the shader text and the parameter names from drifting apart:
 *
 *   1. {@link SAMPLE_WGSL}, spliced into its shader wherever declarations go.
 *   2. {@link deformationParameters}, whose result it feeds to its own shader.
 *
 * A consumer whose geometry has a shape as well as a place -- a Gaussian, where
 * a mesh vertex has only a place and a normal -- splices {@link COVARIANCE_WGSL}
 * after the first. It is a separate export rather than part of it because it is
 * the more expensive half by an order of magnitude, and a surface should not pay
 * to compile what it will never call.
 *
 * @typedef {object} DeformationField
 * @property {object} nodePositions - Live deformed node positions for the whole
 *   scene, vec4f per node. An opaque storage-buffer handle: this file passes it
 *   along and never calls anything on it, which is what lets the channel stay
 *   ignorant of whose renderer is on the other end.
 * @property {number[]} origin - World position of the min corner of cell (0,0,0).
 * @property {number} h - Cell edge length.
 * @property {number[]} cellDims - Cell counts along each axis.
 * @property {number[]} nodeDims - Node counts along each axis.
 * @property {number} nodeOffset - Where this field's nodes start in the shared buffer.
 */

/** The channel's GPU half, as shader source. See `sample.wgsl`. */
export const SAMPLE_WGSL = sampleWgsl;

/**
 * What a Gaussian does with the gradient {@link SAMPLE_WGSL} hands it, as shader
 * source. Depends on nothing but that gradient, so it is spliced after it. See
 * `covariance.wgsl`, and `covariance.js` for why it is the size it is.
 */
export const COVARIANCE_WGSL = covarianceWgsl;

/**
 * What a copy of {@link SAMPLE_WGSL} has to be given to point at one field:
 * every uniform that file declares, and where its value comes from.
 *
 * Returned as data rather than written into a material, and the shape of this
 * function is the whole point. Writing them meant calling the renderer's
 * parameter setter on an object this module did not make, which is a dependency
 * on that renderer's API whether or not an `import` records it -- and the
 * layering test reads imports, so the tree went on claiming this channel
 * depended on nothing while its one function was written against PlayCanvas.
 * Handing back a plain object leaves nothing here to be wrong about: the six
 * names and their sources stay in one place, and applying them is the caller's
 * business, because the caller is the one who owns a renderer.
 *
 * `architecture.test.js` now checks that no renderer's vocabulary appears in
 * this directory at all, which is why the paragraph above names no method.
 *
 * Cheap enough to call every frame, but there is no reason to: the buffer is
 * written in place by the solver, so a field applied once stays live.
 *
 * @param {DeformationField} field - Field to sample.
 * @returns {Record<string, unknown>} Shader parameter names and their values.
 */
export function deformationParameters(field) {
    return {
        deformNodePos: field.nodePositions,
        deformOrigin: field.origin,
        deformH: field.h,
        deformCellDims: field.cellDims,
        deformNodeDims: field.nodeDims,
        deformNodeOffset: field.nodeOffset
    };
}
