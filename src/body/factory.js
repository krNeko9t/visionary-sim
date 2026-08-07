import { loadObj, normalizeMesh, translateMesh } from '../assets/objLoader.js';
import { restOnGround, translateShape } from '../assets/shapes.js';
import { SoftBody } from './softBody.js';

/**
 * Builds bodies from the two rest-geometry sources the scene uses.
 *
 * In both cases `position` is where the *base* of the body sits, and the
 * geometry is placed there before the body is built. A body's rest shape is
 * therefore already in world space, which is why nothing downstream needs a
 * per-body transform.
 */

/**
 * @param {string} url - URL of an OBJ file.
 * @param {object} options - Body options.
 * @param {string} options.name - Body name.
 * @param {number} options.size - Size of the longest axis, in metres.
 * @param {number[]} options.position - Where the base of the body sits.
 * @param {number} [options.resolution] - Requested simulation detail.
 * @param {import('./material.js').Material} [options.material] - Material parameters.
 * @param {number[]} [options.tint] - Linear RGB base colour.
 * @returns {Promise<SoftBody>} The body.
 */
export async function meshBody(url, { name, size, position, resolution, material, tint }) {
    const mesh = await loadObj(url);
    normalizeMesh(mesh.positions, size);
    translateMesh(mesh.positions, position);

    return new SoftBody({
        name,
        source: { kind: 'mesh', mesh },
        renderMesh: mesh,
        material,
        resolution,
        tint
    });
}

/**
 * @param {import('../assets/shapes.js').Shape} shape - Analytic shape, centred on the origin.
 * @param {object} options - Body options.
 * @param {string} options.name - Body name.
 * @param {number[]} options.position - Where the base of the body sits.
 * @param {number} [options.resolution] - Requested simulation detail.
 * @param {import('./material.js').Material} [options.material] - Material parameters.
 * @param {number[]} [options.tint] - Linear RGB base colour.
 * @returns {SoftBody} The body.
 */
export function shapeBody(shape, { name, position, resolution, material, tint }) {
    return new SoftBody({
        name,
        source: { kind: 'shape', shape: translateShape(restOnGround(shape), position) },
        material,
        resolution,
        tint
    });
}
