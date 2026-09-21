import { loadCapture } from '../assets/splats/capture.js';
import { loadObj, normalizeMesh, translateMesh } from '../assets/objLoader.js';
import { restOnGround, translateShape } from '../assets/shapes.js';
import { SoftBody } from './softBody.js';

/**
 * Builds bodies from the rest-geometry sources the scenes use.
 *
 * In all three cases `position` is where the *base* of the body sits, and the
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
        render: { kind: 'mesh', mesh },
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
    const placed = translateShape(restOnGround(shape), position);

    return new SoftBody({
        name,
        source: { kind: 'shape', shape: placed },
        // The shape's own triangles, taken after placement so the render
        // geometry and the distance function describe the same rest pose.
        render: { kind: 'mesh', mesh: placed.surface },
        material,
        resolution,
        tint
    });
}

/**
 * A 3D Gaussian capture, simulated.
 *
 * The one body whose two geometries are the same object: the Gaussians are what
 * is drawn, and they are also all the solver is given to work out where the
 * material is. That is not a shortcut -- there is nothing else in the file --
 * and it is why `sim/discretize/` has a `cloudVolume.js`.
 *
 * The declaration this takes is the same one `loadCapture` takes, and it stays
 * verbose on purpose. Neither the up axis nor the unit can be read out of a PLY,
 * so both are stated by whoever puts the asset in a scene, and the measurements
 * come back on the body so the statement can be checked against the thing.
 *
 * @param {string} url - URL of a binary 3DGS PLY.
 * @param {object} options - Body options.
 * @param {string} options.name - Body name.
 * @param {string} options.convention - Source frame, a key of
 *   {@link import('../assets/splats/place.js').CONVENTIONS}.
 * @param {number} options.size - Size of the longest axis, in metres.
 * @param {number[]} options.position - Where the base of the body sits.
 * @param {number} [options.minOpacity] - Faintness below which a Gaussian is junk.
 * @param {number} [options.resolution] - Requested simulation detail.
 * @param {import('./material.js').Material} [options.material] - Material parameters.
 * @returns {Promise<SoftBody>} The body.
 */
export async function splatBody(url, { name, convention, size, position, minOpacity, resolution, material }) {
    const { cloud, report } = await loadCapture(url, { name, convention, size, position, minOpacity });

    return new SoftBody({
        name,
        source: { kind: 'cloud', cloud, report },
        render: { kind: 'splats', cloud },
        material,
        resolution
    });
}
