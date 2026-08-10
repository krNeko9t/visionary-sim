import { Entity, GSplatData, GSplatResource, WORKBUFFER_UPDATE_ALWAYS } from 'playcanvas';

import { COVARIANCE_WGSL, SAMPLE_WGSL, deformationParameters } from '../deformation/bind.js';
import modifierWgsl from './splats.wgsl?raw';

/**
 * A cloud of 3D Gaussians, seen.
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
 * @property {Float32Array} positions - Centres in world space, 3 per splat.
 * @property {Float32Array} rotations - Unit quaternions, 4 per splat as xyzw.
 * @property {Float32Array} scales - Standard deviations in metres, 3 per splat.
 * @property {Float32Array} opacity - Coverage in [0, 1], 1 per splat.
 * @property {Float32Array} colors - Linear RGB, 3 per splat.
 */

/** Degree-0 spherical harmonic; the engine reads colour as `0.5 + f_dc * SH_C0`. */
const SH_C0 = 0.28209479177387814;

/**
 * @param {import('playcanvas').AppBase} app - The application.
 * @param {string} name - What to call the entity.
 * @param {RestCloud} cloud - Gaussians, already standing in world space.
 * @param {import('../deformation/bind.js').DeformationField} [field] - Deformation
 *   to follow. Omitted for a capture that is only ever scenery.
 * @returns {Entity} An entity drawing the cloud.
 */
export function createSplatView(app, name, cloud, field = null) {
    const entity = new Entity(`splat-view-${name}`);
    entity.addComponent('gsplat', {
        resource: new GSplatResource(app.graphicsDevice, splatData(cloud)),
        castShadows: false
    });

    // The entity transform stays identity, and that is a rule rather than a
    // default: the modifier below is handed *world*-space centres, so a
    // translated entity would ask the deformation field about points outside
    // itself and get extrapolation. Placement is baked into the cloud instead,
    // which is also how mesh bodies work.
    if (field) {
        entity.gsplat.setWorkBufferModifier({
            wgsl: `${SAMPLE_WGSL}\n${COVARIANCE_WGSL}\n${modifierWgsl}`
        });
        // The nodes move every frame and nothing tells the engine so: from its
        // side this cloud is a static resource under a static transform, and it
        // would bake the work buffer once. This is the cost of the whole
        // approach, and it is a re-bake of every splat in the body per frame.
        entity.gsplat.workBufferUpdate = WORKBUFFER_UPDATE_ALWAYS;

        for (const [parameter, value] of Object.entries(deformationParameters(field))) {
            entity.gsplat.setParameter(parameter, value);
        }
    }
    return entity;
}

/**
 * @param {RestCloud} cloud - The Gaussians.
 * @returns {GSplatData} The same numbers in the layout the engine reads.
 */
function splatData(cloud) {
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
    add('f_dc_0', harmonic(cloud.colors, count, 0));
    add('f_dc_1', harmonic(cloud.colors, count, 1));
    add('f_dc_2', harmonic(cloud.colors, count, 2));

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
