/**
 * Material space: the parameters an author thinks in.
 *
 * These are continuum-mechanics quantities and belong to the object, not to
 * whoever simulates it. Young's modulus and Poisson's ratio are first-class
 * inputs rather than a dimensionless "stiffness" slider, which is why the Ten
 * Minute Physics edge-length plus volume constraints were not used -- they have
 * no material meaning at all. What the current solver turns these into lives in
 * `sim/solver/compliance.js`.
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
 * The lower end is now a property of the constitutive model rather than of the
 * solver. Under uniform scaling `F = sI` the stable Neo-Hookean energy is
 * stationary not only at rest but also where `s^3 + s^2 + s = gamma - 1`, and
 * that second point is a maximum -- a barrier. Squash a body past it and the
 * energy falls away to `s = 0`: it collapses to a point, and no amount of
 * substepping helps, because nothing is being solved incorrectly. The barrier
 * reaches `s = 1` at `gamma = 4`, which is nu = 0.125; below that rest is
 * itself the maximum and a body inflates without bound instead.
 *
 * nu = 0.25 is gamma = 2, which puts the barrier at 54% linear compression --
 * a sixth of the rest volume. `collapseScale` in `sim/solver/compliance.js`
 * computes it, the panel reports it beside this slider, and
 * `test/unit/elastic.test.js` checks the formula against what a tetrahedron
 * actually survives.
 *
 * This floor used to be nu = 0.35, for a reason that no longer applies. The
 * two constraints of a tetrahedron were projected one after the other, which
 * damped them unequally -- `|grad C_H| = sqrt(3) |grad C_D|` at rest, so the
 * denominators differed -- and the pair left a net shrink per projection that
 * compounded until the body was a point. Only a hydrostatic constraint stiff
 * enough to lock the volume outright held it off, so gamma had to stay near 1,
 * so nu had to stay near 0.5. Solving the two as a coupled 2x2 block removed
 * that mechanism outright rather than shrinking it: at `F = I` the corrections
 * now cancel identically, for any gamma, dt or mass. See `xpbdCouple` in
 * `sim/solver/wgsl/common.wgsl`.
 *
 * So the floor moved for one reason and stopped for another. What it buys is
 * material that is genuinely compressible: at nu = 0.25 a body can lose a third
 * of its volume under load and spring back, which at nu = 0.4 it cannot.
 */
export const POISSON_RANGE = Object.freeze({ min: 0.25, max: 0.49 });

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
 * Longitudinal wave speed. This is the primitive behind the CFL limit: a
 * substep has to be short enough that a wave cannot cross a cell.
 *
 * Turning it into a substep count needs a cell size, which only exists once a
 * solver has chosen a discretisation, so that lives on the simulation side in
 * `sim/solver/compliance.js`. This function is the only place the wave speed
 * itself is defined.
 *
 * @param {Material} material - The material.
 * @returns {number} Wave speed in m/s.
 */
export function waveSpeed(material) {
    const { mu, lambda } = lameParameters(material);
    return Math.sqrt((lambda + 2 * mu) / material.density);
}
