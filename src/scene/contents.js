import { meshBody, shapeBody } from '../body/factory.js';
import { box, sphere, torus } from '../assets/shapes.js';

/**
 * What is in the tank.
 *
 * The bunny is deliberately absent: at 70k triangles with open holes in its
 * base it is a voxelisation stress test, not scenery. `loadStressBody` builds
 * it on demand for that purpose.
 *
 * Resolutions are per body and mean "cells along the longest axis", so a 0.16 m
 * body at 16 gives 1 cm cells. Everything shares one cell size scale, which
 * keeps the CFL substep requirement uniform across the scene.
 */

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
 * At `h ~ 1.2 cm` and 22 substeps of a 60 Hz frame, the ceiling is around
 * 14 m/s of wave speed, which is where these two sit. `Simulator.cflNumber`
 * reports the live margin, and the UI surfaces it.
 */
const JELLY = { youngsModulus: 1.5e4, poissonRatio: 0.42, density: 1050, friction: 0.35 };
/** Stiffer and denser: lands with a thud and holds its shape. */
const RUBBER = { youngsModulus: 4e4, poissonRatio: 0.45, density: 1100, friction: 0.6 };

/**
 * @returns {Promise<import('../body/softBody.js').SoftBody[]>} The scene's bodies.
 */
export async function createBodies() {
    return Promise.all([
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
    ]);
}

/**
 * The Stanford bunny, for measuring how the pipeline copes with a large,
 * non-watertight mesh. Not part of the default scene.
 *
 * @param {number} [resolution] - Lattice cells along the longest axis.
 * @returns {Promise<import('../body/softBody.js').SoftBody>} The body.
 */
export function loadStressBody(resolution = 24) {
    return meshBody('/models/stanford-bunny.obj', {
        name: 'bunny',
        size: 0.20,
        position: [0, 0.25, 0],
        resolution,
        material: JELLY,
        tint: [0.88, 0.86, 0.82]
    });
}
