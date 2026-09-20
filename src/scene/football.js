import { box, torus } from '../assets/shapes.js';
import { createGlassBox } from './glass.js';
import { meshBody, shapeBody, splatBody } from '../body/factory.js';
import { JELLY, RUBBER } from './tank.js';

/**
 * The fish tank with its analytic ball replaced by a captured football.
 *
 * Every body but the fourth is `tank`'s, and the fourth is what makes this a
 * scene rather than a copy of one. There, the ball was a `Shape`: a distance
 * function for the solver and a hand-written parametrisation for the renderer.
 * Here it is a 3DGS capture -- the same ball, in the same place, made of the
 * other representation. §三 argues the two stand side by side rather than one
 * being a route to the other, and `scene/mixed.js` argues it by dropping a
 * loaf onto a mesh. This argues it by swapping one body, which is a different
 * claim: not "both can exist", but "which one it is is a line the author
 * changes".
 *
 * What does *not* change is the reason the swap is this cheap, so it is worth
 * stating. The capture stands where the sphere stood and is sized to it, so the
 * layout is untouched; its 12 cells come to 8.7 mm against the sphere's 9 at
 * 11.1 mm, and the rubber cube at 11.3 mm is still the body setting the fixed
 * physical step. The scene steps exactly as `tank` does.
 */

/**
 * Interior of the tank, in metres. Its own copy rather than an import: a
 * scene's walls are data it owns, which is what `scene/scenes.js` says kept the
 * tank from being the only thing that could exist.
 */
const BOUNDS = {
    min: [-0.30, 0.0, -0.20],
    max: [0.30, 0.50, 0.20]
};

/** @type {import('./scenes.js').Scene} */
export const footballScene = {
    name: 'football',
    bounds: BOUNDS,
    decorate: app => createGlassBox(app, BOUNDS),
    createBodies: () => Promise.all([
        meshBody('/models/spot.obj', {
            name: 'spot',
            size: 0.17,
            position: [-0.15, 0.18, -0.05],
            resolution: 12,
            material: JELLY,
            tint: [0.95, 0.42, 0.30]
        }),
        meshBody('/models/suzanne.obj', {
            name: 'suzanne',
            size: 0.15,
            position: [0.14, 0.21, 0.06],
            resolution: 12,
            material: RUBBER,
            tint: [0.55, 0.72, 0.95]
        }),
        shapeBody(torus({ majorRadius: 0.052, minorRadius: 0.022 }), {
            name: 'torus',
            position: [0.0, 0.33, 0.0],
            resolution: 12,
            material: JELLY,
            tint: [0.98, 0.76, 0.32]
        }),

        // The ball, and the whole point of the scene: a capture where a shape
        // used to be. A 3DGS PLY states neither its up axis nor its unit, so
        // both are declared here by hand, and the report `assets/splats/
        // capture.js` prints at startup is the only thing that can contradict
        // the declaration. The shape gives no help with the axis -- the three
        // extents come back 0.94, 0.95 and 0.94, so there is no shortest one to
        // read a convention off, and a ball cannot check its own frame.
        //
        // 713681 of the file's 946432 Gaussians survive the opacity cut, and
        // every one of them is re-baked into the work buffer every frame (see
        // `render/splats.js`), which makes this the scene's dominant cost and
        // not the simulation. `minOpacity` is the knob, and it is a blunt one:
        // at 0.5 the shell still keeps half of its splats, so this is a dense
        // capture rather than a dirty one.
        splatBody('/splats/football_trellis1_gs.ply', {
            name: 'football',
            convention: 'y-up',
            size: 0.10,
            position: [-0.16, 0.36, 0.09],
            resolution: 12,
            material: JELLY
        }),

        shapeBody(box({ halfExtents: [0.045, 0.045, 0.045] }), {
            name: 'cube',
            position: [0.17, 0.35, -0.09],
            resolution: 8,
            material: RUBBER,
            tint: [0.80, 0.56, 0.95]
        })
    ])
};
