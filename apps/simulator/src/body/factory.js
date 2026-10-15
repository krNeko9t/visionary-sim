import { restCloud } from '../assets/splats/cloud.js';
import { loadCapture } from '../assets/splats/capture.js';
import { loadObj, normalizeMesh, translateMesh } from '../assets/objLoader.js';
import { restOnGround, translateShape } from '../assets/shapes.js';
import { SoftBody } from 'visionary-sim/body/softBody.js';

/**
 * Builds application objects pairing physical descriptions with drawing data.
 * The array returned by Scene.createObjects keeps construction order: entry i's
 * body is simulator input i, and its drawing uses deformationOf(i). Never filter
 * or reorder entries according to drawing visibility or body name.
 *
 * @typedef {{ kind: 'triangles', mesh: import('visionary-sim/body/restGeometry.js').TriangleMesh }
 *         | { kind: 'gaussians', cloud: import('../assets/splats/cloud.js').SplatCloud }} RenderGeometry
 *
 * @typedef {object} SceneObject
 * @property {SoftBody} body - Physical description, without appearance.
 * @property {RenderGeometry|null} render - Geometry to draw, possibly different from the physical source.
 * @property {number[]} [tint] - Linear RGB base colour.
 * @property {string} [report] - Asset preparation measurements.
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
 * @param {number} [options.elementSize] - Target simulation element size, in metres.
 * @param {import('visionary-sim/body/material.js').Material} [options.material] - Material parameters.
 * @param {number[]} [options.tint] - Linear RGB base colour.
 * @returns {Promise<SceneObject>} Paired body and drawing.
 */
export async function meshBody(url, { name, size, position, elementSize, material, tint = [0.92, 0.45, 0.26] }) {
    const mesh = await loadObj(url);
    normalizeMesh(mesh.positions, size);
    translateMesh(mesh.positions, position);

    return {
        body: new SoftBody({ name, source: { kind: 'mesh', mesh }, material, elementSize }),
        render: { kind: 'triangles', mesh },
        tint
    };
}

/**
 * @param {import('../assets/shapes.js').Shape} shape - Analytic shape, centred on the origin.
 * @param {object} options - Body options.
 * @param {string} options.name - Body name.
 * @param {number[]} options.position - Where the base of the body sits.
 * @param {number} [options.elementSize] - Target simulation element size, in metres.
 * @param {import('visionary-sim/body/material.js').Material} [options.material] - Material parameters.
 * @param {number[]} [options.tint] - Linear RGB base colour.
 * @returns {SceneObject} Paired body and drawing.
 */
export function shapeBody(shape, { name, position, elementSize, material, tint = [0.92, 0.45, 0.26] }) {
    const placed = translateShape(restOnGround(shape), position);

    return {
        body: new SoftBody({
            name, source: { kind: 'shape', shape: { sdf: placed.sdf, bounds: placed.bounds } },
            material, elementSize
        }),
        render: { kind: 'triangles', mesh: placed.surface },
        tint
    };
}

/**
 * A 3D Gaussian capture, simulated.
 *
 * The physical and drawing descriptions share prepared Gaussian arrays: they are what
 * is drawn, and they are also all the solver is given to work out where the
 * material is. That is not a shortcut -- there is nothing else in the file --
 * and it is why a point cloud is one of the three sources
 * `sim/discretize/discretize.js` accepts.
 *
 * The declaration this takes is the same one `loadCapture` takes, and it stays
 * verbose on purpose. Neither the up axis nor the unit can be read out of a PLY,
 * so both are stated by whoever puts the asset in a scene, and the measurements
 * come back on the application object so the statement can be checked against the thing.
 *
 * @param {string} url - URL of a binary 3DGS PLY.
 * @param {object} options - Body options.
 * @param {string} options.name - Body name.
 * @param {string} options.convention - Source frame, a key of
 *   {@link import('../assets/splats/place.js').CONVENTIONS}.
 * @param {number} options.size - Size of the longest axis, in metres.
 * @param {number[]} options.position - Where the base of the body sits.
 * @param {number} [options.minOpacity] - Faintness below which a Gaussian is junk.
 * @param {number} [options.elementSize] - Target simulation element size, in metres.
 * @param {import('visionary-sim/body/material.js').Material} [options.material] - Material parameters.
 * @returns {Promise<SceneObject>} Paired body and drawing.
 */
export async function splatBody(url, { name, convention, size, position, minOpacity, elementSize, material }) {
    const { cloud, report } = await loadCapture(url, { name, convention, size, position, minOpacity });

    return {
        body: new SoftBody({ name, source: { kind: 'cloud', cloud: restCloud(cloud) }, material, elementSize }),
        render: { kind: 'gaussians', cloud },
        report
    };
}
