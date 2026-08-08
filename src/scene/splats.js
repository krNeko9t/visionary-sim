import { createGlassBox } from './glass.js';
import { loadCapture } from '../assets/splats/capture.js';
import { splatBody } from '../body/factory.js';

/**
 * Two scans standing in a tank: one simulated, one only drawn.
 *
 * The declarations below are half the point of this scene. A 3DGS PLY states
 * neither its up axis nor its units, so both are written down here by hand and
 * checked against the report each capture prints. These two disagree with each
 * other -- `bread` came out y-up, `wolf` z-up -- which is the whole argument
 * against picking one convention and calling it the standard.
 *
 * The other half is the split. `bread` is a body: the same Gaussians are handed
 * to the solver, which invents a volume from them and cuts it into cells.
 * `wolf` is scenery: drawn, never stepped, costing nothing but its pixels. That
 * is not a demonstration, it is what a scene-scale capture needs -- it arrives
 * split across several files and only some of them will ever be objects.
 */

/** Room enough for both, and the same open-topped box the fish tank uses. */
const BOUNDS = {
    min: [-0.30, 0.0, -0.20],
    max: [0.30, 0.50, 0.20]
};

/**
 * Soft and light, and bounded by CFL like every other material here.
 *
 * Lighter than the tank's jelly because a loaf is, and that costs substeps: the
 * wave speed is `sqrt((lambda + 2 mu) / rho)`, so dividing the density is the
 * same as multiplying the stiffness. At 9.4 mm cells this sits around 15
 * substeps of a 60 Hz frame, which leaves headroom under the cap.
 */
const CRUMB = { youngsModulus: 1.2e4, poissonRatio: 0.40, density: 700, friction: 0.5 };

/** @type {import('./scenes.js').Scene} */
export const splatScene = {
    name: 'splats',
    bounds: BOUNDS,
    decorate: app => createGlassBox(app, BOUNDS),
    createBodies: () => Promise.all([
        splatBody('/splats/bread.ply', {
            name: 'bread',
            convention: 'y-up',
            size: 0.18,
            position: [-0.13, 0.0, 0.0],
            // 9.4 mm cells. Finer than this and the stamped shell of this
            // particular capture starts needing the seal in
            // `sim/discretize/cloudVolume.js` to stay solid at all.
            resolution: 20,
            material: CRUMB
        })
    ]),
    scenery: () => Promise.all([
        loadCapture('/splats/wolf.ply', {
            name: 'wolf',
            convention: 'z-up',
            size: 0.24,
            position: [0.13, 0.0, 0.0]
        })
    ])
};
