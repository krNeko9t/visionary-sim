import { meshBounds } from '../../assets/objLoader.js';
import { buildLattice } from './lattice.js';
import { voxelizeMesh, voxelizeSdf } from './voxelize.js';

/**
 * Turns a body the author described into degrees of freedom the solver can move.
 *
 * This is the one place that decides *how* an object is discretised, and it is
 * on the simulation side of the fence on purpose: swapping the voxel lattice
 * for something else is a change to this directory and nothing above it.
 */

/**
 * @param {import('../../body/softBody.js').SoftBody} body - The body to discretise.
 * @returns {import('./lattice.js').Lattice} Its simulation geometry.
 */
export function discretizeBody(body) {
    const { source, resolution, material } = body;
    const grid = source.kind === 'mesh'
        ? voxelizeMesh(source.mesh, meshBounds(source.mesh.positions), { resolution })
        : voxelizeSdf(source.shape, { resolution });

    return buildLattice(grid, { density: material.density });
}

/**
 * Re-spreads node masses after a density change.
 *
 * Node masses are a discretisation artefact -- they exist because the lattice
 * lumps a cell's mass onto its corners -- so keeping them consistent with
 * `density * volume` is this module's job, not the body's.
 *
 * @param {import('./lattice.js').Lattice} lattice - Lattice to update in place.
 * @param {number} previousDensity - Density the masses were built from.
 * @param {number} density - New density in kg/m^3.
 */
export function relumpMasses(lattice, previousDensity, density) {
    const ratio = previousDensity / density;
    const { invMass, nodeCount } = lattice;
    for (let n = 0; n < nodeCount; n++) {
        invMass[n] *= ratio;
    }
    lattice.mass = lattice.volume * density;
}
