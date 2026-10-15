import { applyFieldParameters } from './playcanvasInterop.js';
import { Color, Entity, Mesh, MeshInstance, SHADERLANGUAGE_WGSL, StandardMaterial } from 'playcanvas';

import { restNormals } from './normals.js';
import vertexHookWgsl from './mesh.wgsl?raw';

/**
 * A body seen as a triangle surface.
 *
 * The surface never changes; the field it is bound to does. Every vertex asks
 * the deformation channel where its rest position went and how the space around
 * it was stretched, so a mesh of any density rides a proxy of any coarseness
 * without the two knowing about each other.
 *
 * The engine's standard material does the actual shading. It is extended
 * through the two hook points it publishes for this -- declarations and the end
 * of the vertex shader -- rather than replaced, so these surfaces light, shadow
 * and tone-map exactly like the tank around them, and no engine code is copied
 * here to rot.
 *
 * @typedef {object} RestSurface
 * @property {Float32Array} positions - Rest vertex positions in world space, 3 floats each.
 * @property {Uint32Array} indices - Triangle indices, 3 per triangle.
 */

/**
 * The engine version these hooks were written against. The engine warns when it
 * moves past it, which is the signal to re-read what the hooks are spliced into.
 */
const CHUNKS_VERSION = '2.21';

/**
 * @param {import('playcanvas').AppBase} app - The application.
 * @param {RestSurface} surface - Rest geometry to be carried by the field.
 * @param {import('visionary-sim/deformation/bind.js').DeformationField} field - Deformation to follow.
 * @param {object} [options] - Appearance.
 * @param {number[]} [options.tint] - Linear RGB base colour.
 * @param {number} [options.gloss] - Specular sharpness in [0, 1].
 * @returns {Entity} An entity holding the surface.
 */
export function createMeshView(app, surface, field, { tint = [0.92, 0.45, 0.26], gloss = 0.55 } = {}) {
    const material = new StandardMaterial();
    material.diffuse = new Color(tint[0], tint[1], tint[2]);
    material.useMetalness = true;
    material.metalness = 0;
    material.gloss = gloss;

    material.shaderChunksVersion = CHUNKS_VERSION;
    const chunks = material.getShaderChunks(SHADERLANGUAGE_WGSL);
    chunks.set('litUserDeclarationVS', field.shader);
    chunks.set('litUserMainEndVS', vertexHookWgsl);
    applyFieldParameters(material, field);
    material.update();

    const mesh = new Mesh(app.graphicsDevice);
    mesh.setPositions(surface.positions);
    mesh.setNormals(restNormals(surface.positions, surface.indices));
    mesh.setIndices(surface.indices);
    mesh.update();

    const entity = new Entity('mesh-view');
    const instance = new MeshInstance(mesh, material, entity);
    // The vertex shader moves every vertex, so the CPU-side bounds describe the
    // rest pose and nothing else. Culling against them would drop a body that
    // had deformed or fallen out of its own rest bounds.
    instance.cull = false;
    entity.addComponent('render', { meshInstances: [instance], castShadows: true });
    return entity;
}
