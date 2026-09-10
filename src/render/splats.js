import { Entity, GSplatData, GSplatResource, WORKBUFFER_UPDATE_ALWAYS } from 'playcanvas';

import { COVARIANCE_WGSL } from '../deformation/bind.js';
import { registerInstanceColorModifier } from './instanceColors.js';
import ellipsoidWgsl from './ellipsoid.wgsl?raw';
import modifierWgsl from './splats.wgsl?raw';

/**
 * A cloud of Gaussian ellipsoids or two-axis surfels, seen.
 *
 * The second representation on this bank of the channel, next to `mesh.js`. It
 * takes the geometry it needs as plain arrays and declares their shape here
 * rather than importing a type from `assets/` -- the same arrangement the mesh
 * path uses, and the reason `render/` can claim to depend on nothing but the
 * deformation channel.
 *
 * A cloud may be bound to a deformation field or not, and both are real uses: a
 * captured backdrop is drawn once and never moves, while a captured object that
 * was handed to the solver has to follow it. The difference is one argument
 * because it is one difference -- the same cloud, the same resource, the same
 * everything, with a hook installed or not.
 *
 * Where the mesh path extends a material, this one extends the engine's *work
 * buffer* pass. That is not a variation for its own sake: a splat is not drawn
 * from the arrays below, it is drawn from a buffer the engine bakes them into,
 * and the sort order and the projection are computed from that buffer. Deforming
 * anywhere later would move the Gaussians without moving what the renderer
 * believes about them.
 *
 * @typedef {object} RestCloud
 * @property {number} count - Number of Gaussians.
 * @property {Float32Array} positions - Centres in entity-local source space, 3 per splat.
 * @property {Float32Array} rotations - Unit quaternions, 4 per splat as xyzw.
 * @property {Float32Array} scales - Standard deviations in metres, 3 per splat.
 * @property {Float32Array} opacity - Coverage in [0, 1], 1 per splat.
 * @property {Float32Array} [colors] - Linear RGB, 3 per splat for legacy clouds.
 * @property {Float32Array[]} [dc] - Source DC harmonics, one array per channel.
 * @property {Float32Array[]} [sphericalHarmonics] - Source `f_rest_0..44` arrays.
 * @property {2|3} [dimensionality] - Two selects PlayCanvas's 2DGS path.
 */

/** Degree-0 spherical harmonic; the engine reads colour as `0.5 + f_dc * SH_C0`. */
const SH_C0 = 0.28209479177387814;
const OWNED_RESOURCE = new WeakMap();
const DESTROYED_VIEWS = new WeakSet();

/**
 * @param {import('playcanvas').AppBase} app - The application.
 * @param {string} name - What to call the entity.
 * @param {RestCloud} cloud - Gaussians, already standing in world space.
 * @param {import('../deformation/bind.js').DeformationField} [field] - Deformation
 *   to follow. Omitted for a capture that is only ever scenery.
 * @returns {Entity} An entity drawing the cloud.
 */
export function createSplatView(app, name, cloud, field = null, { twoDimensional = cloud.dimensionality === 2 } = {}) {
    app.scene.gsplat.twoDimensional = twoDimensional;
    const entity = new Entity(`splat-view-${name}`);
    const resource = new GSplatResource(app.graphicsDevice, createSplatData(cloud));
    OWNED_RESOURCE.set(entity, resource);
    try {
        entity.addComponent('gsplat', {
            resource,
            castShadows: false
        });

        // PlayCanvas applies the entity/root TRS before invoking this modifier,
        // so a deforming imported view keeps its source cloud under the same
        // calibrated root. The field receives world centres and world ellipsoid
        // axes while SH evaluation retains the source-model view direction.
        if (field) {
            entity.gsplat.setWorkBufferModifier({
                wgsl: `${field.shader}\n${COVARIANCE_WGSL}\n${ellipsoidWgsl}\n${modifierWgsl}`
            });
            registerInstanceColorModifier(entity.gsplat);
            entity.gsplat.workBufferUpdate = WORKBUFFER_UPDATE_ALWAYS;

            for (const [parameter, value] of Object.entries(field.parameters)) {
                entity.gsplat.setParameter(parameter, value);
            }
            entity.gsplat.setParameter('inspectionColor', new Float32Array([1, 1, 1]));
            entity.gsplat.setParameter('inspectionMix', 0);
            entity.gsplat.setParameter('deformationProbe', 0);
        }
        return entity;
    } catch (error) {
        try {
            destroySplatView(entity);
        } catch (cleanupError) {
            console.error('[splats] failed to clean a rejected view', cleanupError);
        }
        throw error;
    }
}

/** Destroy a splat entity and the directly assigned resource the component does not own. */
export function destroySplatView(entity) {
    if (!entity || DESTROYED_VIEWS.has(entity)) return;
    DESTROYED_VIEWS.add(entity);
    const resource = OWNED_RESOURCE.get(entity);
    OWNED_RESOURCE.delete(entity);
    try {
        entity.destroy();
    } finally {
        resource?.destroy();
    }
}

/**
 * @param {RestCloud} cloud - The Gaussians.
 * @returns {GSplatData} The same numbers in the layout the engine reads.
 */
export function createSplatData(cloud) {
    const { count } = cloud;
    const properties = [];
    const add = (name, storage) => properties.push({ type: 'float', name, storage, byteSize: 4 });

    add('x', component(cloud.positions, count, 3, 0));
    add('y', component(cloud.positions, count, 3, 1));
    add('z', component(cloud.positions, count, 3, 2));

    // The engine names the real part `rot_0` and the imaginary ones `rot_1..3`;
    // everything upstream of here is xyzw. One reordering, at the door.
    add('rot_0', component(cloud.rotations, count, 4, 3));
    add('rot_1', component(cloud.rotations, count, 4, 0));
    add('rot_2', component(cloud.rotations, count, 4, 1));
    add('rot_3', component(cloud.rotations, count, 4, 2));

    add('scale_0', component(cloud.scales, count, 3, 0));
    add('scale_1', component(cloud.scales, count, 3, 1));
    add('scale_2', component(cloud.scales, count, 3, 2));
    add('opacity', Float32Array.from(cloud.opacity));

    // Colour is the one field `activated` does not cover: the engine always
    // reads it as a degree-0 harmonic, so linear RGB has to go back through the
    // constant it came in on.
    for (let channel = 0; channel < 3; channel++) {
        add(`f_dc_${channel}`, cloud.dc?.[channel] ?? harmonic(cloud.colors, count, channel));
    }
    if (cloud.sphericalHarmonics) {
        if (cloud.sphericalHarmonics.length !== 45) throw new Error('sphericalHarmonics must contain 45 coefficient arrays');
        cloud.sphericalHarmonics.forEach((storage, index) => add(`f_rest_${index}`, storage));
    }

    const data = new GSplatData([{ name: 'vertex', count, properties }]);
    // Scales are already metres and opacity is already coverage. Without this
    // the engine would take an exponential and a sigmoid of both, and the cloud
    // would render as a handful of enormous, uniformly opaque blobs.
    data.activated = true;
    return data;
}

/**
 * @param {Float32Array} packed - Interleaved values.
 * @param {number} count - Number of items.
 * @param {number} stride - Values per item.
 * @param {number} offset - Which value to take.
 * @returns {Float32Array} That value from every item.
 */
function component(packed, count, stride, offset) {
    const out = new Float32Array(count);
    for (let i = 0; i < count; i++) {
        out[i] = packed[i * stride + offset];
    }
    return out;
}

/**
 * @param {Float32Array} colors - Linear RGB, 3 per splat.
 * @param {number} count - Number of splats.
 * @param {number} channel - 0, 1 or 2.
 * @returns {Float32Array} The degree-0 coefficient the engine expects.
 */
function harmonic(colors, count, channel) {
    const out = new Float32Array(count);
    for (let i = 0; i < count; i++) {
        out[i] = (colors[i * 3 + channel] - 0.5) / SH_C0;
    }
    return out;
}
