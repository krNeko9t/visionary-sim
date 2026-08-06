/**
 * Material space: the parameters an author thinks in, and the numbers the
 * solver needs.
 *
 * The constitutive model is the stable Neo-Hookean of Macklin & Muller (2021)
 * in XPBD form. Each tetrahedron carries two constraints:
 *
 *   deviatoric   C_D = ||F||_F              compliance 1 / (mu * V)
 *   hydrostatic  C_H = det(F) - gamma       compliance 1 / (lambda * V)
 *
 * with `gamma = 1 + mu / lambda`. Because the compliances *are* the Lame
 * parameters, Young's modulus and Poisson's ratio are first-class inputs rather
 * than a dimensionless "stiffness" slider. That is the reason this model was
 * chosen over the edge-length plus volume constraints of the Ten Minute Physics
 * reference, which have no material meaning at all.
 *
 * @typedef {object} Material
 * @property {number} youngsModulus - E, in pascals. Jelly is around 1e4..1e6.
 * @property {number} poissonRatio - nu, dimensionless. See {@link POISSON_RANGE}.
 * @property {number} density - rho, in kg/m^3. Water and most soft tissue are ~1000.
 * @property {number} friction - Coulomb friction coefficient for contacts.
 * @property {number} damping - Velocity damping rate, per second.
 */

/**
 * Poisson's ratio is clamped to the range this solver is stable over.
 *
 * The upper end is the obvious one: at nu = 0.5 the material is perfectly
 * incompressible and lambda diverges.
 *
 * The lower end is not obvious and was found by measurement, not by taste.
 * With one projection per substep the XPBD correction is scaled by
 * `1 / (sum(w |grad C|^2) + alpha~)`, and the two constraints of a tetrahedron
 * do not get the same scaling: `|grad C_H| = sqrt(3) |grad C_D|` at rest, so
 * the hydrostatic term is damped harder than the deviatoric one. Writing
 * `r = sum(w |grad C_D|^2) / alpha~_D`, the two corrections that should cancel
 * exactly at `F = I` instead leave a net shrink of
 *
 *     1 - (gamma - 1)(r + 1) / (3r + gamma - 1)
 *
 * per projection pair. The error vanishes as `r -> 0` (that is, as the substep
 * shrinks), but at a practical substep it is percent-level and compounds. The
 * only thing that stops it compounding into total collapse is a hydrostatic
 * constraint stiff enough to lock the volume outright, which needs
 * `lambda >> mu`, which means gamma near 1, which means large nu.
 *
 * Measured on the tank scene: nu = 0.45 (gamma 1.11) and nu = 0.40 (gamma 1.25)
 * hold their shape indefinitely; nu = 0.35 (gamma 1.43) is stable; nu = 0.25
 * (gamma 2.0) collapses to a point within seconds, as does nu = 0.05.
 *
 * This rules out compressible foams, not any of the soft materials this project
 * is aimed at -- jelly, rubber and flesh all sit at nu = 0.35..0.49. Supporting
 * lower nu needs the two constraints solved as a coupled 2x2 block rather than
 * sequentially, which is a real change to the solver, not a tuning exercise.
 */
export const POISSON_RANGE = Object.freeze({ min: 0.35, max: 0.49 });

/** @type {Material} */
export const DEFAULT_MATERIAL = Object.freeze({
    youngsModulus: 1.2e5,
    poissonRatio: 0.40,
    density: 1000,
    friction: 0.4,
    damping: 0.6
});

/**
 * @param {number} value - Value to clamp.
 * @param {number} min - Lower bound.
 * @param {number} max - Upper bound.
 * @returns {number} The clamped value.
 */
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * Converts engineering constants to Lame parameters.
 *
 * @param {Pick<Material, 'youngsModulus' | 'poissonRatio'>} material - Engineering constants.
 * @returns {{ mu: number, lambda: number }} Shear modulus and first Lame parameter.
 */
export function lameParameters({ youngsModulus, poissonRatio }) {
    const nu = clamp(poissonRatio, POISSON_RANGE.min, POISSON_RANGE.max);
    const e = Math.max(youngsModulus, 1);
    return {
        mu: e / (2 * (1 + nu)),
        lambda: (e * nu) / ((1 + nu) * (1 - 2 * nu))
    };
}

/**
 * Inverse of {@link lameParameters}, used to keep the UI honest about what the
 * solver actually received after clamping.
 *
 * @param {{ mu: number, lambda: number }} lame - Lame parameters.
 * @returns {{ youngsModulus: number, poissonRatio: number }} Engineering constants.
 */
export function engineeringConstants({ mu, lambda }) {
    return {
        youngsModulus: (mu * (3 * lambda + 2 * mu)) / (lambda + mu),
        poissonRatio: lambda / (2 * (lambda + mu))
    };
}

/**
 * Per-element solver constants.
 *
 * @param {Material} material - The material.
 * @param {number} restVolume - Rest volume of one element, in cubic metres.
 * @returns {{ deviatoric: number, hydrostatic: number, gamma: number }} XPBD constants.
 */
export function elementConstants(material, restVolume) {
    const { mu, lambda } = lameParameters(material);
    return {
        deviatoric: 1 / (mu * restVolume),
        hydrostatic: 1 / (lambda * restVolume),
        gamma: 1 + mu / lambda
    };
}

/**
 * Longitudinal wave speed. This is the primitive behind the CFL limit: a
 * substep has to be short enough that a wave cannot cross a cell.
 *
 * Turning it into a substep count needs a cell size, which is a property of a
 * body rather than of a material, so that lives on {@link SoftBody#waveRatio}
 * and {@link Simulator#recommendedSubsteps}. This function is the only place
 * the wave speed itself is defined.
 *
 * @param {Material} material - The material.
 * @returns {number} Wave speed in m/s.
 */
export function waveSpeed(material) {
    const { mu, lambda } = lameParameters(material);
    return Math.sqrt((lambda + 2 * mu) / material.density);
}
