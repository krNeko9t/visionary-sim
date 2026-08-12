import covarianceWgsl from './covariance.wgsl?raw';
import sampleWgsl from './sample.wgsl?raw';

/**
 * The one way a material reads the deformation.
 *
 * There is exactly one implementation of this because the dependency rules leave
 * nowhere else to put it: a render path may reach only `deformation/`, the debug
 * view may reach only `sim/discretize/` and `deformation/`, so the single place
 * both can see is here. Anything that wanted its own copy would have to break the
 * layering to get one.
 *
 * A field answers two questions and only two, in words belonging to neither bank:
 *
 *   - given a rest point, where is it now;
 *   - given a rest point, how was the space around it stretched.
 *
 * A trilinear lattice can answer those. So can anything that replaces it. That is
 * why a field is handed out as {@link DeformationField} -- a piece of shader text
 * and a bag of parameters -- rather than as a description of a grid: **what the
 * parameters are called is the sampler's own business**, and a consumer that
 * forwards them without reading them keeps working when the sampler changes.
 * {@link latticeField} is the one sampler that exists today, and its name says so.
 *
 * A consumer whose geometry has a shape as well as a place -- a Gaussian, where a
 * mesh vertex has only a place and a normal -- splices {@link COVARIANCE_WGSL}
 * after the field's own text. It is a separate export rather than part of it
 * because a surface should not pay to compile what it will never call.
 *
 * @typedef {object} DeformationField
 * @property {string} shader - WGSL declaring `deformationAt(rest) -> Deformation`,
 *   to be spliced wherever the consumer's shader takes declarations.
 * @property {Record<string, unknown>} parameters - What that text has to be given,
 *   by name. Opaque: a consumer sets them and never looks inside. Handed over as
 *   plain data rather than written into a material, because writing them would
 *   mean calling some renderer's parameter setter from in here -- a dependency on
 *   that renderer's API whether or not an `import` records it, and the layering
 *   test reads imports. Applying them is the caller's business, because the caller
 *   is the one who owns a renderer.
 */

/**
 * What a Gaussian does with the gradient a field hands it, as shader source: it
 * comes out as a covariance, which is what an ellipsoid is. Depends on nothing
 * but that gradient, so it is spliced after the field's text. See
 * `covariance.wgsl`, and `covariance.js` for the derivation.
 */
export const COVARIANCE_WGSL = covarianceWgsl;

/**
 * A field sampled trilinearly from a uniform lattice of nodes.
 *
 * The six names below are this sampler's, not the channel's, and they appear
 * nowhere outside this file and `sample.wgsl`. Replacing the lattice means
 * writing a sibling of this function with its own names and its own text; no
 * consumer changes, because no consumer reads either.
 *
 * Cheap enough to call every frame, but there is no reason to: the node buffer is
 * written in place by the solver, so a field applied once stays live.
 *
 * @param {object} lattice - The sampled grid.
 * @param {object} lattice.nodePositions - Live deformed node positions for the
 *   whole scene, vec4f per node. An opaque storage-buffer handle: this file passes
 *   it along and never calls anything on it, which is what lets the channel stay
 *   ignorant of whose renderer is on the other end.
 * @param {number[]} lattice.origin - World position of the min corner of cell (0,0,0).
 * @param {number} lattice.h - Cell edge length.
 * @param {number[]} lattice.cellDims - Cell counts along each axis.
 * @param {number[]} lattice.nodeDims - Node counts along each axis.
 * @param {number} lattice.nodeOffset - Where this field's nodes start in the shared buffer.
 * @returns {DeformationField} That lattice as a field.
 */
export function latticeField({ nodePositions, origin, h, cellDims, nodeDims, nodeOffset }) {
    return {
        shader: sampleWgsl,
        parameters: {
            deformNodePos: nodePositions,
            deformOrigin: origin,
            deformH: h,
            deformCellDims: cellDims,
            deformNodeDims: nodeDims,
            deformNodeOffset: nodeOffset
        }
    };
}
