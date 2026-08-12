import { box, sphere, torus } from '../assets/shapes.js';
import { createGlassBox } from './glass.js';
import { meshBody, shapeBody } from '../body/factory.js';

/**
 * The fish tank, and what stands in it.
 *
 * Resolutions are per body and mean "cells along the longest axis", so a 0.16 m
 * body at 16 gives 1 cm cells. Everything shares one cell size scale, which
 * keeps the CFL substep requirement uniform across the scene.
 */

/**
 * Interior of the tank, in metres. Plain data on purpose: the simulation
 * consumes it as six analytic planes and must not depend on PlayCanvas. The top
 * is open -- there is no `y = max` wall.
 */
const BOUNDS = {
    min: [-0.30, 0.0, -0.20],
    max: [0.30, 0.50, 0.20]
};

/**
 * Stiffness is bounded by the CFL condition, not by taste.
 *
 * The XPBD compliance only damps a projection while `alpha/dt^2` stays above
 * `sum(w |grad C|^2)`; past that both constraints are projected hard, and
 * projecting the deviatoric constraint `||F|| -> 0` hard means `F -> 0` -- the
 * body collapses to a point. That ratio is exactly the CFL number
 * `c * dt_substep / h` with `c = sqrt((lambda + 2 mu) / rho)`, so a material is
 * only as stiff as the cell size and substep count can carry.
 *
 * The fixed physical step is chosen from that ratio at startup and whenever a
 * material changes. Render refresh only changes how many such steps are
 * submitted; `Simulator.cflNumber` reports the invariant margin.
 */
export const JELLY = { youngsModulus: 1.5e4, poissonRatio: 0.42, density: 1050, friction: 0.35 };
/** Stiffer and denser: lands with a thud and holds its shape. */
const RUBBER = { youngsModulus: 4e4, poissonRatio: 0.45, density: 1100, friction: 0.6 };

/** @type {import('./scenes.js').Scene} */
export const tankScene = {
    name: 'tank',
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
        shapeBody(sphere({ radius: 0.05 }), {
            name: 'sphere',
            position: [-0.16, 0.36, 0.09],
            resolution: 9,
            material: JELLY,
            tint: [0.55, 0.90, 0.62]
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

/**
 * The same tank holding the Stanford bunny, for measuring how the pipeline
 * copes with a large, non-watertight mesh: 70k triangles with open holes in its
 * base is a voxelisation stress test rather than scenery, which is why it is
 * its own scene instead of a sixth body in the one above.
 *
 * @type {import('./scenes.js').Scene}
 */
export const bunnyScene = {
    name: 'bunny',
    bounds: BOUNDS,
    decorate: tankScene.decorate,
    createBodies: () => Promise.all([
        meshBody('/models/stanford-bunny.obj', {
            name: 'bunny',
            size: 0.20,
            position: [0, 0.25, 0],
            resolution: 24,
            material: JELLY,
            tint: [0.88, 0.86, 0.82]
        })
    ])
};
