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
 * to the solver, which invents a volume from them and cuts it into elements.
 * `wolf` is scenery: drawn, never stepped, costing nothing but its pixels. That
 * is not a demonstration, it is what a scene-scale capture needs -- it arrives
 * split across several files and only some of them will ever be objects.
 *
 * What neither file states is what it is a picture *of*, and that matters once:
 * `bread` is a loaf, and `wolf` is a sitting plush toy, limbs tucked against its
 * body rather than a realistic animal's. The tucking is why the seal that
 * closes a capture into a volume is argued against this one -- it is the one
 * here with gaps a seal could wrongly bridge. Both are 61 MB
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
 * same as multiplying the stiffness. At 9.5 mm elements this costs roughly 15
 * fixed physical steps per 1/60 s of wall time.
 */
export const CRUMB = { youngsModulus: 1.2e4, poissonRatio: 0.40, density: 700, friction: 0.5 };

/** Softer and lighter than the loaf, with enough friction for the loaf to settle on it. */
const PLUSH = { youngsModulus: 6e3, poissonRatio: 0.35, density: 450, friction: 0.7 };

/** Shared capture declarations: file coordinates are properties of the asset, not of a scene. */
export const BREAD = {
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
            // Finer than 9.5 mm and this particular capture starts needing
            // the seal that closes it into a volume to stay solid at all.
            elementSize: 0.0095,
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
 * Elements of 15.8 and 21.2 mm deliberately favour the Gen12LP GPU: they cut
 * elastic and contact work and, being larger, permit a longer stable physical
 * step. Neither size reduces the per-frame work-buffer bake of either cloud.
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
            elementSize: 0.0158,
            material: CRUMB
        }),
        bodyOf(WOLF, {
            position: [0.0, 0.0, 0.0],
            elementSize: 0.0212,
            material: PLUSH
        })
    ])
};
