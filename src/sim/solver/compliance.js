import { lameParameters, waveSpeed } from '../../body/material.js';
import { KUHN_TET_VOLUME_FRACTION } from '../discretize/kuhn.js';

/**
 * What a material becomes once XPBD is the solver.
 *
 * Everything specific to *this* solver formulation lives here rather than in
 * `body/material.js`: a material is Young's modulus and Poisson's ratio no
 * matter who solves it, but compliances and gamma only mean something to XPBD.
 * Replacing the solver replaces this file and leaves the material alone.
 *
 * The constitutive model is the stable Neo-Hookean of Macklin & Muller (2021).
 * Each tetrahedron carries two constraints:
 *
 *   deviatoric   C_D = ||F||_F              compliance 1 / (mu * V)
 *   hydrostatic  C_H = det(F) - gamma       compliance 1 / (lambda * V)
 */

/**
 * @param {import('../discretize/lattice.js').Lattice} lattice - Simulation geometry.
 * @returns {number} Rest volume of a single tetrahedron, in m^3.
 */
export function tetRestVolume(lattice) {
    return KUHN_TET_VOLUME_FRACTION * lattice.h ** 3;
}

/**
 * XPBD compliances for a material at a given discretisation.
 *
 * Cheap to recompute, which is what makes the material sliders live: only a
 * handful of uniforms change, never the lattice.
 *
 * @param {import('../../body/material.js').Material} material - The material.
 * @param {import('../discretize/lattice.js').Lattice} lattice - Simulation geometry.
 * @returns {{ deviatoric: number, hydrostatic: number, gamma: number }} Solver constants.
 */
export function elementCompliance(material, lattice) {
    const { mu, lambda } = lameParameters(material);
    const restVolume = tetRestVolume(lattice);
    return {
        deviatoric: 1 / (mu * restVolume),
        hydrostatic: 1 / (lambda * restVolume),
        gamma: 1 + mu / lambda
    };
}

/**
 * Cell crossings per second: how fast an elastic wave moves through a body
 * relative to its own cell size.
 *
 * Multiplying by a substep duration gives the CFL number, so this is the
 * quantity that decides how finely a body has to be stepped. It mixes material
 * and discretisation on purpose: a stiff material in coarse cells can be
 * cheaper to step than a soft one in fine cells, and pairing the scene's
 * fastest material with the scene's smallest cell -- usually different bodies
 * -- overstates the requirement badly.
 *
 * @param {import('../../body/material.js').Material} material - The material.
 * @param {import('../discretize/lattice.js').Lattice} lattice - Simulation geometry.
 * @returns {number} Wave speed divided by cell size, in 1/s.
 */
export function waveRatio(material, lattice) {
    return waveSpeed(material) / lattice.h;
}
