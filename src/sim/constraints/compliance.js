import { lameParameters, waveSpeed } from '../../body/material.js';
import { KUHN_TET_VOLUME_FRACTION } from '../discretize/lattice/kuhn.js';

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
 * @param {import('../discretize/lattice/lattice.js').Lattice} lattice - Simulation geometry.
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
 * @param {import('../discretize/lattice/lattice.js').Lattice} lattice - Simulation geometry.
 * @returns {{ deviatoric: number, hydrostatic: number, gamma: number }} Solver constants.
 */
export function elementCompliance(material, lattice) {
    const { mu, lambda } = lameParameters(material);
    const restVolume = tetRestVolume(lattice);
    return {
        deviatoric: 1 / (mu * restVolume),
        hydrostatic: 1 / (lambda * restVolume),
        gamma: gammaOf(material)
    };
}

/**
 * The hydrostatic constraint's rest offset, `1 + mu / lambda`.
 *
 * A property of the material alone: no element size enters it, so anything
 * that only wants gamma asks here rather than going through a discretisation.
 *
 * @param {import('../../body/material.js').Material} material - The material.
 * @returns {number} gamma.
 */
export function gammaOf(material) {
    const { mu, lambda } = lameParameters(material);
    return 1 + mu / lambda;
}

/**
 * How far a body can be squashed before it stops coming back.
 *
 * The stable Neo-Hookean energy has a stationary point besides `F = I`. Under
 * uniform scaling `F = sI` its derivative factors as
 *
 *     (s - 1) * (lambda * s * (s^2 + s + 1) - mu)
 *
 * so alongside rest there is a root at `s^3 + s^2 + s = gamma - 1`. It is an
 * energy *maximum*: a barrier. Compress a body past it and the energy keeps
 * falling all the way to `s = 0`, which is the collapse-to-a-point that has
 * nothing to do with any solver.
 *
 * The barrier sits at `s = 1` exactly when `gamma = 4`. Above that it moves
 * above rest, rest becomes the maximum, and the body inflates without bound
 * instead -- which is why {@link POISSON_RANGE} has a lower end at all now that
 * the projection is no longer what limits it.
 *
 * Bisection rather than Cardano: the left side is strictly increasing for
 * positive s, forty halvings of [0, 4] land well inside f32, and the reader can
 * check it against the formula above without expanding a cubic.
 *
 * @param {number} gamma - The hydrostatic constraint's rest offset, `1 + mu / lambda`.
 * @returns {number} Uniform scale of the barrier. Below 1 while gamma is below 4.
 */
export function collapseScale(gamma) {
    let low = 0;
    let high = 4;
    for (let i = 0; i < 40; i++) {
        const s = (low + high) / 2;
        if (s ** 3 + s ** 2 + s < gamma - 1) {
            low = s;
        } else {
            high = s;
        }
    }
    return (low + high) / 2;
}

/**
 * How many times per second an elastic wave crosses a body's `cflLength`.
 *
 * Multiplying by a substep duration gives the CFL number, so this is the
 * quantity that decides how finely a body has to be stepped. It mixes material
 * and discretisation on purpose: a stiff material in coarse elements can be
 * cheaper to step than a soft one in fine elements, and pairing the scene's
 * fastest material with the scene's shortest length -- usually different bodies
 * -- overstates the requirement badly.
 *
 * @param {import('../../body/material.js').Material} material - The material.
 * @param {number} cflLength - The body's stability length, metres; see
 *   `ProxyGeometry.cflLength`.
 * @returns {number} Wave speed divided by that length, in 1/s.
 */
export function waveRatio(material, cflLength) {
    return waveSpeed(material) / cflLength;
}
