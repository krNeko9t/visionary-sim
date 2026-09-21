import { meshBounds } from '../../assets/objLoader.js';
import { elasticConstraints as latticeElasticConstraints } from './lattice/elasticCells.js';
import { buildLattice } from './lattice/lattice.js';
import { VoxelLattice } from './lattice/voxelLattice.js';
import { voxelizeCloud } from './lattice/cloudVolume.js';
import { voxelizeMesh, voxelizeSdf } from './lattice/voxelize.js';

/**
 * Turns a body the author described into degrees of freedom the solver can move.
 *
 * This is the one place that decides *how* an object is discretised, and it is
 * on the simulation side of the fence on purpose: swapping the voxel lattice
 * for something else is a change to this directory and nothing above it.
 */

/**
 * How each kind of rest geometry becomes an occupancy grid.
 *
 * A table rather than a chain of conditionals, because the number of entries is
 * the thing that grows: every new way of describing an object arrives here, and
 * arriving here should mean adding a line rather than editing a branch.
 *
 * @type {Record<string, (source: any, options: object) => import('./lattice/voxelize.js').OccupancyGrid>}
 */
const VOXELIZERS = {
    mesh: (source, options) => voxelizeMesh(source.mesh, meshBounds(source.mesh.positions), options),
    shape: (source, options) => voxelizeSdf(source.shape, options),
    cloud: (source, options) => voxelizeCloud(source.cloud, options)
};

/**
 * @param {import('../../body/softBody.js').SoftBody} body - The body to discretise.
 * @returns {import('./proxyGeometry.js').ProxyGeometry} Its simulation geometry.
 */
export function discretizeBody(body) {
    const { source, resolution, material } = body;
    const voxelize = VOXELIZERS[source.kind];
    if (!voxelize) {
        throw new Error(`no way to discretise rest geometry of kind "${source.kind}"`);
    }

    return new VoxelLattice(buildLattice(voxelize(source, { resolution }), { density: material.density }));
}

/**
 * Who builds the elastic constraints, one entry per implementation. Each picks
 * out the proxies that are its own and ignores the rest.
 */
const ELASTIC = [latticeElasticConstraints];

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
