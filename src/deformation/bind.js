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
 *   2. {@link bindDeformation}, called once with the field to sample.
 *
 * @typedef {object} DeformationField
 * @property {import('playcanvas').StorageBuffer} nodePositions - Live deformed node
 *   positions for the whole scene, vec4f per node.
 * @property {number[]} origin - World position of the min corner of cell (0,0,0).
 * @property {number} h - Cell edge length.
 * @property {number[]} cellDims - Cell counts along each axis.
 * @property {number[]} nodeDims - Node counts along each axis.
 * @property {number} nodeOffset - Where this field's nodes start in the shared buffer.
 */

/** The channel's GPU half, as shader source. See `sample.wgsl`. */
export const SAMPLE_WGSL = sampleWgsl;

/**
 * Points a material's copy of {@link SAMPLE_WGSL} at one field.
 *
 * Cheap enough to call every frame, but there is no reason to: the buffer is
 * written in place by the solver, so a field bound once stays live.
 *
 * @param {import('playcanvas').Material} material - Material whose shader includes the channel.
 * @param {DeformationField} field - Field to sample.
 */
export function bindDeformation(material, field) {
    material.setParameter('deformNodePos', field.nodePositions);
    material.setParameter('deformOrigin', field.origin);
    material.setParameter('deformH', field.h);
    material.setParameter('deformCellDims', field.cellDims);
    material.setParameter('deformNodeDims', field.nodeDims);
    material.setParameter('deformNodeOffset', field.nodeOffset);
}
