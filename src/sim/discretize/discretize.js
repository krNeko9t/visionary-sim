import { elasticConstraints as elasticOfTheOnlyKind } from './lattice/elasticCells.js';
import { discretizeBody as proxyOfTheOnlyKind } from './lattice/voxelLattice.js';

/**
 * Turns a body the author described into degrees of freedom the solver can move.
 *
 * This is the one place that decides *which* proxy geometry an object gets, and
 * it is on the simulation side of the fence on purpose: adding a second kind is
 * a change to this directory and nothing above it. How any one kind is built is
 * that kind's business, in its own directory; this file only chooses, and today
 * there is one kind to choose.
 */

/**
 * @param {import('../../body/softBody.js').SoftBody} body - The body to discretise.
 * @returns {import('./proxyGeometry.js').ProxyGeometry} Its simulation geometry.
 */
export function discretizeBody(body) {
    return proxyOfTheOnlyKind(body);
}

/**
 * Who builds the elastic constraints, one entry per implementation. Each picks
 * out the proxies that are its own and ignores the rest.
 */
const ELASTIC = [elasticOfTheOnlyKind];

/**
 * The elastic constraints of every body in the scene: what the proxy geometry
 * hands the solver that is not per body.
 *
 * The discretisation builds them, not `sim/constraints/`, because an element,
 * its rest shape and the rule for batching elements are all knowledge of how
 * the body was cut up. Contact is the opposite case and stays over there: it
 * couples bodies, and one broadphase has to see all of them (ADR-0007).
 *
 * @param {import('playcanvas').GraphicsDevice} device - WebGPU device.
 * @param {import('../state/particles.js').Particles} particles - Every body's nodes.
 * @param {import('./proxyGeometry.js').ProxyGeometry[]} proxies - Every body's proxy, in scene order.
 * @param {import('../../body/material.js').Material[]} materials - Each body's
 *   material, same order, edited in place later.
 * @returns {import('./proxyGeometry.js').ElasticConstraint[]} In the order they should be solved.
 */
export function elasticConstraints(device, particles, proxies, materials) {
    return ELASTIC.flatMap(build => build(device, particles, proxies, materials));
}
