import { box, sphere, torus } from '../assets/shapes.js';
import { createGlassBox } from './glass.js';
import { meshBody, shapeBody } from '../body/factory.js';

/**
 * The fish tank, and what stands in it.
 *
 * Element sizes are per body and in metres, and every body in `tankScene`
 * sits between 11.2 and 14.2 mm. That shared scale is on purpose: the substep
 * a body can survive shrinks with its element size (and with its material's
 * wave speed), and the whole scene steps at the rate its most demanding body
 * needs. A body cut far finer than the rest would make everyone pay for it;
 * keeping every `elementSize` within a narrow band keeps the CFL requirement
 * uniform across the scene, so only the materials set it apart.
 */

/**
 * Interior of the tank, in metres. Plain data on purpose: the simulation
 * consumes it as five analytic planes and must not depend on PlayCanvas. The top
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
 * `c * dt_substep / cflLength` with `c = sqrt((lambda + 2 mu) / rho)`, so a
 * material is only as stiff as the element size and substep count can carry.
 *
 * The fixed physical step is chosen from that ratio at startup and whenever a
 * material changes. Render refresh only changes how many such steps are
 * submitted; `Simulator.cflNumber` reports the invariant margin.
 */
export const JELLY = { youngsModulus: 1.5e4, poissonRatio: 0.42, density: 1050, friction: 0.35 };
/** Stiffer and denser: lands with a thud and holds its shape. */
export const RUBBER = { youngsModulus: 4e4, poissonRatio: 0.45, density: 1100, friction: 0.6 };

/** @type {import('./scenes.js').Scene} */
export const tankScene = {
    name: 'tank',
    bounds: BOUNDS,
    decorate: app => createGlassBox(app, BOUNDS),
    createObjects: () => Promise.all([
        meshBody('/models/spot.obj', {
            name: 'spot',
            size: 0.17,
            position: [-0.15, 0.18, -0.05],
            elementSize: 0.0142,
            material: JELLY,
            tint: [0.95, 0.42, 0.30]
        }),
        meshBody('/models/suzanne.obj', {
            name: 'suzanne',
            size: 0.15,
            position: [0.14, 0.21, 0.06],
            elementSize: 0.0125,
            material: RUBBER,
            tint: [0.55, 0.72, 0.95]
        }),
        shapeBody(torus({ majorRadius: 0.052, minorRadius: 0.022 }), {
            name: 'torus',
            position: [0.0, 0.33, 0.0],
            elementSize: 0.0124,
            material: JELLY,
            tint: [0.98, 0.76, 0.32]
        }),
        shapeBody(sphere({ radius: 0.05 }), {
            name: 'sphere',
            position: [-0.16, 0.36, 0.09],
            elementSize: 0.0112,
            material: JELLY,
            tint: [0.55, 0.90, 0.62]
        }),
        shapeBody(box({ halfExtents: [0.045, 0.045, 0.045] }), {
            name: 'cube',
            position: [0.17, 0.35, -0.09],
            elementSize: 0.0113,
            material: RUBBER,
            tint: [0.80, 0.56, 0.95]
        })
    ])
};

/**
 * The same tank holding the Stanford bunny, for measuring how the pipeline
 * copes with a large, non-watertight mesh: 70k triangles with open holes in its
 * base is a stress test for turning a mesh into a volume rather than scenery,
 * which is why it is its own scene instead of a sixth body in the one above.
 *
 * @type {import('./scenes.js').Scene}
 */
export const bunnyScene = {
    name: 'bunny',
    bounds: BOUNDS,
    decorate: tankScene.decorate,
    createObjects: () => Promise.all([
        meshBody('/models/stanford-bunny.obj', {
            name: 'bunny',
            size: 0.20,
            position: [0, 0.25, 0],
            elementSize: 0.0084,
            material: JELLY,
            tint: [0.88, 0.86, 0.82]
        })
    ])
};
