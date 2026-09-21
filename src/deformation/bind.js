import covarianceWgsl from './covariance.wgsl?raw';
import normalWgsl from './normal.wgsl?raw';

/**
 * The one way a material reads the deformation.
 *
 * This file holds a contract, not an implementation. Whoever discretised a body
 * hands out its field (`field()` in `sim/discretize/proxyGeometry.js`); the
 * render side only ever sees the shape written here.
 *
 * A field answers two questions and only two, in words belonging to neither bank:
 *
 *   - given a rest point, where is it now;
 *   - given a rest point, how was the space around it stretched.
 *
 * That is why a field is handed out as {@link DeformationField} -- a piece of
 * shader text and a bag of parameters -- rather than as a description of the
 * nodes behind it: **what the parameters are called is the sampler's own
 * business**, and a consumer that forwards them without reading them keeps
 * working when the sampler changes.
 *
 * The contract is the WGSL function
 *
 *     fn deformationAt(rest: vec3f) -> Deformation
 *
 * where `Deformation` is `struct { position: vec3f, gradient: mat3x3f }`, the
 * gradient column-major like every `mat3x3f`. The field's text declares both.
 * Nothing else it declares is part of the contract, and a consumer that calls
 * anything else is reading one sampler's internals.
 *
 * What a consumer does with the gradient is not the sampler's business, so it is
 * handed out here rather than in the field's text: a surface splices
 * {@link NORMAL_WGSL}, a Gaussian {@link COVARIANCE_WGSL}. Separate exports
 * rather than one, because a consumer should not pay to compile what it will
 * never call.
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
 * What a surface does with the gradient a field hands it, as shader source: a
 * rest normal comes out as a deformed one. Depends on nothing but that
 * gradient, so it is spliced after the field's text. See `normal.wgsl`.
 */
export const NORMAL_WGSL = normalWgsl;
