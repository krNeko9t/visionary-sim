import { buildLattice } from '../geometry/lattice.js';
import { loadObj, meshBounds, normalizeMesh, translateMesh } from '../geometry/objLoader.js';
import { restOnGround, translateShape } from '../geometry/shapes.js';
import { voxelizeMesh, voxelizeSdf } from '../geometry/voxelize.js';
import { DEFAULT_MATERIAL } from './material.js';
import { SoftBody } from './softBody.js';

/**
 * Builds soft bodies from the two geometry sources the scene uses.
 *
 * In both cases `position` is where the *base* of the body sits, and the
 * geometry is placed there before voxelisation. The lattice therefore lives in
 * world space and its rest state is the body's starting state, so the solver
 * needs no per-body transform at all.
 */

/**
 * @param {string} url - URL of an OBJ file.
 * @param {object} options - Body options.
 * @param {string} options.name - Body name.
 * @param {number} options.size - Size of the longest axis, in metres.
 * @param {number[]} options.position - Where the base of the body sits.
 * @param {number} [options.resolution] - Lattice cells along the longest axis.
 * @param {import('./material.js').Material} [options.material] - Material parameters.
 * @param {number[]} [options.tint] - Linear RGB base colour.
 * @returns {Promise<SoftBody>} The body.
 */
export async function meshBody(url, { name, size, position, resolution = 16, material, tint }) {
    const mesh = await loadObj(url);
    normalizeMesh(mesh.positions, size);
    translateMesh(mesh.positions, position);

    const grid = voxelizeMesh(mesh, meshBounds(mesh.positions), { resolution });
    return finish({ name, grid, material, tint, renderMesh: mesh });
}

/**
 * @param {import('../geometry/shapes.js').Shape} shape - Analytic shape, centred on the origin.
 * @param {object} options - Body options.
 * @param {string} options.name - Body name.
 * @param {number[]} options.position - Where the base of the body sits.
 * @param {number} [options.resolution] - Lattice cells along the longest axis.
 * @param {import('./material.js').Material} [options.material] - Material parameters.
 * @param {number[]} [options.tint] - Linear RGB base colour.
 * @returns {SoftBody} The body.
 */
export function shapeBody(shape, { name, position, resolution = 16, material, tint }) {
    const placed = translateShape(restOnGround(shape), position);
    return finish({ name, grid: voxelizeSdf(placed, { resolution }), material, tint });
}

/**
 * @param {object} options - Assembled inputs.
 * @param {string} options.name - Body name.
 * @param {import('../geometry/voxelize.js').OccupancyGrid} options.grid - Occupancy.
 * @param {import('./material.js').Material} [options.material] - Material parameters.
 * @param {number[]} [options.tint] - Linear RGB base colour.
 * @param {import('../geometry/objLoader.js').TriangleMesh} [options.renderMesh] - Render geometry.
 * @returns {SoftBody} The body.
 */
function finish({ name, grid, material, tint, renderMesh = null }) {
    const resolved = { ...DEFAULT_MATERIAL, ...material };
    return new SoftBody({
        name,
        lattice: buildLattice(grid, { density: resolved.density }),
        material: resolved,
        renderMesh,
        tint
    });
}
