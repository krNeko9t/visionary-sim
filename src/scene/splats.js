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
 *
 * What neither file states is what it is a picture *of*, and that matters once:
 * `bread` is a loaf, and `wolf` is a sitting plush toy, limbs tucked against its
 * body rather than a realistic animal's. The tucking is why
 * `sim/discretize/cloudVolume.js` argues the seal width against this capture --
 * it is the one here with gaps a seal could wrongly bridge. Both are 61 MB
 * binaries no test opens, so this is the only place either shape is written
 * down; anything else describing them is being written from memory.
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

/** Softer and lighter than the loaf, with enough friction for the loaf to settle on it. */
const PLUSH = { youngsModulus: 6e3, poissonRatio: 0.35, density: 450, friction: 0.7 };

/** Shared capture declarations: file coordinates are properties of the asset, not of a scene. */
const BREAD = {
    url: '/splats/bread.ply',
    name: 'bread',
    convention: 'y-up',
    size: 0.18,
    position: [-0.13, 0.0, 0.0]
};
const WOLF = {
    url: '/splats/wolf.ply',
    name: 'wolf',
    convention: 'z-up',
    size: 0.24,
    position: [0.13, 0.0, 0.0]
};

/** Loads one declared capture as scenery, keeping its asset declaration in one place. */
function captureOf({ url, ...options }, overrides = {}) {
    return loadCapture(url, { ...options, ...overrides });
}

/** Loads the same declaration as a body, adding only simulation-specific choices. */
function bodyOf({ url, ...options }, overrides) {
    return splatBody(url, { ...options, ...overrides });
}

/** @type {import('./scenes.js').Scene} */
export const splatScene = {
    name: 'splats',
    bounds: BOUNDS,
    decorate: app => createGlassBox(app, BOUNDS),
    createBodies: () => Promise.all([
        bodyOf(BREAD, {
            // 9.4 mm cells. Finer than this and the stamped shell of this
            // particular capture starts needing the seal in
            // `sim/discretize/cloudVolume.js` to stay solid at all.
            resolution: 20,
            material: CRUMB
        })
    ]),
    scenery: () => Promise.all([
        captureOf(WOLF)
    ])
};

/**
 * Both captures as bodies. The wolf starts on the floor and the loaf falls onto
 * it, so the scene exercises the same cross-body contact path as mesh bodies.
 * Twelve cells on the longest axis deliberately favours the Gen12LP GPU: it
 * cuts elastic and contact work and, through the larger cells, needs fewer CFL
 * substeps. It does not reduce the per-frame work-buffer bake of either cloud.
 *
 * @type {import('./scenes.js').Scene}
 */
export const splatContactScene = {
    name: 'splats-contact',
    bounds: BOUNDS,
    decorate: splatScene.decorate,
    createBodies: () => Promise.all([
        bodyOf(BREAD, {
            position: [0.0, 0.30, 0.0],
            resolution: 12,
            material: CRUMB
        }),
        bodyOf(WOLF, {
            position: [0.0, 0.0, 0.0],
            resolution: 12,
            material: PLUSH
        })
    ])
};
