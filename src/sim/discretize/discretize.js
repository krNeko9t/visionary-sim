import { meshBounds } from '../../assets/objLoader.js';
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
