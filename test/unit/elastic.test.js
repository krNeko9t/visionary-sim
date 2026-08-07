import { describe, expect, it } from 'vitest';

import { DEFAULT_MATERIAL, POISSON_RANGE, lameParameters } from '../../src/body/material.js';
import { CUBE_CORNERS } from '../../src/deformation/corners.js';
import { KUHN_TETS, kuhnRestShapeInverses } from '../../src/sim/discretize/kuhn.js';
import { mat3Determinant, mat3FromColumns, mat3Multiply } from '../../src/sim/discretize/mat3.js';
import { collapseScale, elementCompliance, tetRestVolume } from '../../src/sim/constraints/compliance.js';

/**
 * What one tetrahedron's projection does, and where the material's limits
 * actually come from.
 *
 * The scheme lives in `sim/constraints/wgsl/project.wgsl` and cannot be run here, so
 * this file carries a transcription of it -- the same status as the WGSL copy of
 * `cellCoords`, and kept honest the same way, by reading the two side by side.
 * Both schemes are transcribed: the coupled 2x2 block that ships, and the
 * sequential pair it replaced, because the claim is a *difference* between them
 * and a test that only ran the winner would not show it.
 *
 * Two separate things are established below, and keeping them apart is the
 * point of the file:
 *
 * 1. The block solve is exact at rest. `F = I` is a fixed point of the
 *    projection to machine precision, for any Poisson ratio. The sequential
 *    pair is not, and a free tetrahedron under it collapses within a second.
 * 2. What still bounds the Poisson ratio is not the solver at all. The stable
 *    Neo-Hookean energy has a second stationary point, and a body squashed past
 *    it never returns. That barrier is computed in closed form by
 *    `collapseScale`, and the tests below check the formula against what a
 *    tetrahedron actually survives.
 */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
];

/**
 * @param {ArrayLike<number>} m - Column-major 3x3 matrix.
 * @param {number} c - Column index.
 * @returns {number[]} That column.
 */
const column = (m, c) => [m[c * 3], m[c * 3 + 1], m[c * 3 + 2]];

/**
 * @param {ArrayLike<number>} m - Column-major 3x3 matrix.
 * @returns {Float32Array} Its transpose.
 */
const transpose = m => mat3FromColumns(
    [m[0], m[3], m[6]],
    [m[1], m[4], m[7]],
    [m[2], m[5], m[8]]
);

/**
 * Turns `(dC/dF) * B^T` into the four node gradients. The first follows from
 * translation invariance: a constraint that cannot see a rigid shift has
 * gradients summing to zero.
 *
 * @param {ArrayLike<number>} m - `(dC/dF) * B^T`, column-major.
 * @returns {number[][]} Gradients for nodes 0..3.
 */
function nodeGradients(m) {
    const g = [column(m, 0), column(m, 1), column(m, 2)];
    return [scale(add(add(g[0], g[1]), g[2]), -1), ...g];
}

/**
 * Both constraints of a tetrahedron and their gradients, at one configuration.
 *
 * @param {number[][]} p - The four node positions.
 * @param {ArrayLike<number>} B - Rest shape inverse, column-major.
 * @param {number} gamma - Rest offset of the hydrostatic constraint.
 * @returns {{ cDev: number, cHyd: number, gDev: number[][], gHyd: number[][] }} The pair.
 */
function constraints(p, B, gamma) {
    const F = mat3Multiply(mat3FromColumns(sub(p[1], p[0]), sub(p[2], p[0]), sub(p[3], p[0])), B);
    const f = [column(F, 0), column(F, 1), column(F, 2)];
    const Bt = transpose(B);

    const cDev = Math.hypot(...F);
    const inv = cDev > 1e-9 ? 1 / cDev : 0;
    const dDev = mat3FromColumns(scale(f[0], inv), scale(f[1], inv), scale(f[2], inv));
    const dHyd = mat3FromColumns(cross(f[1], f[2]), cross(f[2], f[0]), cross(f[0], f[1]));

    return {
        cDev,
        cHyd: mat3Determinant(F) - gamma,
        gDev: nodeGradients(mat3Multiply(dDev, Bt)),
        gHyd: nodeGradients(mat3Multiply(dHyd, Bt))
    };
}

/**
 * The projection the solver performs: one 2x2 block, both constraints read at
 * the same deformation gradient.
 *
 * @param {number[][]} p - The four node positions.
 * @param {ArrayLike<number>} B - Rest shape inverse, column-major.
 * @param {number[]} w - Inverse masses.
 * @param {{ alphaDev: number, alphaHyd: number, gamma: number }} c - Solver constants,
 *   compliances already divided by dt^2.
 * @param {object} [damping] - Kelvin-Voigt term; omitted means perfectly elastic.
 * @param {number[][]} [damping.prev] - Positions at the start of the substep.
 * @param {number} [damping.relax] - Relaxation time divided by the substep.
 * @returns {number[][]} Corrected positions.
 */
function projectCoupled(p, B, w, { alphaDev, alphaHyd, gamma }, { prev = p, relax = 0 } = {}) {
    const { cDev, cHyd, gDev, gHyd } = constraints(p, B, gamma);
    const [a00, a01, a11] = gram(gDev, gHyd, w, alphaDev, alphaHyd, relax);

    const motion = p.map((q, i) => sub(q, prev[i]));
    const rate = g => motion.reduce((sum, d, i) => sum + dot(g[i], d), 0);
    const bDev = -(cDev + rate(gDev) * relax);
    const bHyd = -(cHyd + rate(gHyd) * relax);

    const det = a00 * a11 - a01 * a01;
    const lDev = (a11 * bDev - a01 * bHyd) / det;
    const lHyd = (a00 * bHyd - a01 * bDev) / det;

    return p.map((q, i) => add(q, scale(add(scale(gDev[i], lDev), scale(gHyd[i], lHyd)), w[i])));
}

/**
 * The block matrix, compliances included and the gradient part stiffened by the
 * damping the way XPBD's `(1 + gamma)` factor does.
 *
 * @param {number[][]} gDev - Deviatoric gradients.
 * @param {number[][]} gHyd - Hydrostatic gradients.
 * @param {number[]} w - Inverse masses.
 * @param {number} alphaDev - Deviatoric compliance over dt^2.
 * @param {number} alphaHyd - Hydrostatic compliance over dt^2.
 * @param {number} [relax] - Relaxation time divided by the substep.
 * @returns {number[]} `[a00, a01, a11]`.
 */
function gram(gDev, gHyd, w, alphaDev, alphaHyd, relax = 0) {
    let a00 = 0;
    let a01 = 0;
    let a11 = 0;
    for (let i = 0; i < 4; i++) {
        a00 += w[i] * dot(gDev[i], gDev[i]);
        a01 += w[i] * dot(gDev[i], gHyd[i]);
        a11 += w[i] * dot(gHyd[i], gHyd[i]);
    }
    const stiffened = 1 + relax;
    return [a00 * stiffened + alphaDev, a01 * stiffened, a11 * stiffened + alphaHyd];
}

/**
 * The projection the solver used to perform: deviatoric first, then hydrostatic
 * re-read from the corrected positions. Kept only so the tests can show what
 * changed.
 *
 * @param {number[][]} p - The four node positions.
 * @param {ArrayLike<number>} B - Rest shape inverse, column-major.
 * @param {number[]} w - Inverse masses.
 * @param {{ alphaDev: number, alphaHyd: number, gamma: number }} c - Solver constants.
 * @returns {number[][]} Corrected positions.
 */
function projectSequential(p, B, w, { alphaDev, alphaHyd, gamma }) {
    /**
     * @param {number[][]} positions - Positions going in.
     * @param {'Dev'|'Hyd'} which - Constraint to project.
     * @param {number} alpha - Its compliance.
     * @returns {number[][]} Positions coming out.
     */
    const one = (positions, which, alpha) => {
        const found = constraints(positions, B, gamma);
        const c = found[`c${which}`];
        const g = found[`g${which}`];
        const denom = w.reduce((sum, wn, i) => sum + wn * dot(g[i], g[i]), alpha);
        const s = -c / denom;
        return positions.map((q, i) => add(q, scale(g[i], s * w[i])));
    };

    return one(one(p, 'Dev', alphaDev), 'Hyd', alphaHyd);
}

/**
 * Cell size, a power of two on purpose: `h` and `1/h` are then both exact in
 * f32, so the rest tetrahedron really does give `F = I` and "at rest" is not
 * quietly a 1e-8 strain. Anything else measures the seed error instead of the
 * scheme.
 */
const H = 0.03125;

/** Substep: 60 Hz at the default 20 substeps. */
const DT = 1 / (60 * 20);

/**
 * A rest tetrahedron and everything the projection needs to act on it.
 *
 * @param {number} poissonRatio - Compressibility to set up for.
 * @param {number} [tet] - Which of the six Kuhn tetrahedra.
 * @returns {{ p: number[][], B: Float32Array, w: number[], c: object }} The setup.
 */
function restTet(poissonRatio, tet = 0) {
    const material = { ...DEFAULT_MATERIAL, poissonRatio };
    const lattice = { h: H };
    const { deviatoric, hydrostatic, gamma } = elementCompliance(material, lattice);

    // Lumped the way the lattice lumps: the tetrahedron's mass over its corners.
    const nodeMass = (material.density * tetRestVolume(lattice)) / 4;

    const { mu, lambda } = lameParameters(material);

    return {
        p: KUHN_TETS[tet].map(c => CUBE_CORNERS[c].map(x => x * H)),
        B: kuhnRestShapeInverses(H)[tet],
        w: Array.from({ length: 4 }, () => 1 / nodeMass),
        mu,
        lambda,
        volume: tetRestVolume(lattice),
        c: {
            alphaDev: deviatoric / (DT * DT),
            alphaHyd: hydrostatic / (DT * DT),
            gamma
        }
    };
}

/**
 * @param {number[][]} a - Positions before.
 * @param {number[][]} b - Positions after.
 * @returns {number} Largest node displacement, in metres.
 */
const moved = (a, b) => Math.max(...a.map((q, i) => Math.hypot(...sub(b[i], q))));

/**
 * @param {number[][]} p - The four node positions.
 * @returns {number} Signed volume.
 */
const volume = p => mat3Determinant(
    mat3FromColumns(sub(p[1], p[0]), sub(p[2], p[0]), sub(p[3], p[0]))
) / 6;

/**
 * Runs a free tetrahedron -- no gravity, no contact, no damping -- so that the
 * only thing moving it is the projection. Undamped on purpose: damping would
 * hide exactly the drift these tests are looking for.
 *
 * @param {object} setup - From {@link restTet}, optionally with `p` replaced.
 * @param {Function} project - Which scheme to use.
 * @param {number} substeps - How many substeps to run.
 * @param {number} [relax] - Relaxation time divided by the substep.
 * @returns {number[][]} Final positions.
 */
function run({ p, B, w, c }, project, substeps, relax = 0) {
    let positions = p;
    let velocity = p.map(() => [0, 0, 0]);

    for (let s = 0; s < substeps; s++) {
        const prev = positions;
        positions = positions.map((q, i) => add(q, scale(velocity[i], DT * (w[i] > 0 ? 1 : 0))));
        positions = project(positions, B, w, c, { prev, relax });
        velocity = positions.map((q, i) => scale(sub(q, prev[i]), 1 / DT));
    }
    return positions;
}

/**
 * Elastic energy stored in one tetrahedron *above its rest value*, which is what
 * the damping is supposed to remove and rigid motion is not supposed to contain.
 *
 * The subtraction is not cosmetic. This energy is not zero at rest -- `C_D` is
 * `sqrt(3)` there and `C_H` is `-mu/lambda` -- and the rest value is large
 * enough to bury the ring being measured.
 *
 * @param {number[][]} p - The four node positions.
 * @param {object} setup - From {@link restTet}.
 * @returns {number} Energy in joules above rest.
 */
function stored(p, setup) {
    const { B, c, mu, lambda, volume } = setup;
    const at = (positions) => {
        const { cDev, cHyd } = constraints(positions, B, c.gamma);
        return 0.5 * mu * volume * cDev * cDev + 0.5 * lambda * volume * cHyd * cHyd;
    };
    return at(p) - at(setup.p);
}

/**
 * @param {object} setup - From {@link restTet}.
 * @param {number} factor - Uniform scale to start from.
 * @returns {object} The same setup, scaled about the origin.
 */
const scaled = (setup, factor) => ({ ...setup, p: setup.p.map(q => scale(q, factor)) });

/** Poisson ratios spanning the legal range, plus its two ends. */
const RATIOS = [POISSON_RANGE.min, 0.3, 0.35, 0.45, POISSON_RANGE.max];

describe('the coupled 2x2 projection', () => {
    it('leaves a tetrahedron at rest exactly where it is, at any Poisson ratio', () => {
        // The property the block solve buys, and an identity rather than a
        // tuning: at F = I the two gradients are parallel, and the block moves
        // along that shared direction by a factor carrying
        // (alphaDev * mu / lambda - alphaHyd), which is zero because both are
        // 1 / (lambda * V). Nothing about dt, mass or volume enters.
        //
        // In exact arithmetic the residue is zero. What is left here is single
        // precision: `mat3.js` works in f32 -- deliberately, being the GPU's
        // precision -- and rounding `1/sqrt(3) * 32` breaks the exact
        // parallelism the cancellation rides on. 5e-11 m on a 3 cm tetrahedron
        // is 2e-9 of it, an f32 epsilon or two. The scheme it replaced moves the
        // same tetrahedron by 1e-3 m, seven orders further.
        for (const nu of RATIOS) {
            const setup = restTet(nu);
            const after = projectCoupled(setup.p, setup.B, setup.w, setup.c);

            expect(moved(setup.p, after), `nu = ${nu}`).toBeLessThan(1e-9);
        }
    });

    it('holds every one of the six Kuhn tetrahedra, not just the first', () => {
        for (let tet = 0; tet < KUHN_TETS.length; tet++) {
            const setup = restTet(POISSON_RANGE.min, tet);
            const after = projectCoupled(setup.p, setup.B, setup.w, setup.c);

            expect(moved(setup.p, after), `tet ${tet}`).toBeLessThan(1e-9);
        }
    });

    it('is what the sequential projection could not do', () => {
        // The scheme that shipped before moves a resting tetrahedron by about a
        // millimetre on the very first projection -- 3% of this cell -- and does
        // it again every substep.
        for (const nu of RATIOS) {
            const setup = restTet(nu);
            const after = projectSequential(setup.p, setup.B, setup.w, setup.c);

            expect(moved(setup.p, after), `nu = ${nu}`).toBeGreaterThan(1e-4);
        }
    });

    it('holds a free tetrahedron at rest for a second; the old scheme loses it', () => {
        const setup = restTet(POISSON_RANGE.min);

        expect(volume(run(setup, projectCoupled, 1200)) / volume(setup.p)).toBeCloseTo(1, 6);
        expect(volume(run(setup, projectSequential, 1200)) / volume(setup.p)).toBeLessThan(0.5);
    });

    it('brings a squashed tetrahedron back to its rest volume', () => {
        // Undamped, so it is still ringing after a second; what matters is that
        // it rings about the rest volume rather than about a smaller one, which
        // is what the sequential scheme could not manage.
        const setup = restTet(POISSON_RANGE.min);
        const ratio = volume(run(scaled(setup, 0.9), projectCoupled, 1200)) / volume(setup.p);

        expect(ratio).toBeGreaterThan(0.6);
        expect(ratio).toBeLessThan(1.4);
    });

    it('conserves momentum, because every gradient set sums to zero', () => {
        const setup = restTet(0.3);
        const squashed = { ...setup, p: setup.p.map(q => [q[0], q[1] * 0.7, q[2]]) };
        const after = projectCoupled(squashed.p, setup.B, setup.w, setup.c);

        // Equal masses here, so the displacements themselves have to sum to zero.
        const total = after.reduce((sum, q, i) => add(sum, sub(q, squashed.p[i])), [0, 0, 0]);
        for (const axis of total) {
            expect(Math.abs(axis)).toBeLessThan(1e-12);
        }
    });

    it('stays finite on a fully collapsed tetrahedron', () => {
        // F = 0 has no deviatoric direction, so the kernel zeroes that gradient
        // rather than branching. That is all the guard is for. It does not buy
        // recovery: the hydrostatic gradient is the cofactor matrix, which
        // vanishes at F = 0 too, so a tetrahedron squashed to a single point is
        // a fixed point of the projection with or without the guard. What the
        // guard prevents is the NaN spreading to the rest of the cell.
        const setup = restTet(0.35);
        const collapsed = { ...setup, p: setup.p.map(() => [0, 0, 0]) };
        const after = projectCoupled(collapsed.p, setup.B, setup.w, setup.c);

        expect(after.flat().every(Number.isFinite)).toBe(true);
    });

    it('cannot go singular, however parallel the two gradients get', () => {
        // Cauchy-Schwarz bounds the off-diagonal by the gradient parts of the
        // diagonal, so what survives in the determinant is at least the product
        // of the two compliances. This is why the kernel needs no conditioning
        // check beyond an underflow guard.
        for (const nu of RATIOS) {
            const { p, B, w, c } = restTet(nu);
            const { gDev, gHyd } = constraints(p, B, c.gamma);
            const [a00, a01, a11] = gram(gDev, gHyd, w, c.alphaDev, c.alphaHyd);

            expect(a00 * a11 - a01 * a01, `nu = ${nu}`)
                .toBeGreaterThanOrEqual(c.alphaDev * c.alphaHyd);
        }
    });
});

describe('the Kelvin-Voigt damping term', () => {
    /** A generous relaxation time over the substep -- 40 ms, the slider's top. */
    const RELAX = 0.04 / DT;

    it('changes nothing at all when the relaxation time is zero', () => {
        const setup = restTet(0.35);
        const squashed = setup.p.map(q => [q[0], q[1] * 0.8, q[2]]);
        const bare = projectCoupled(squashed, setup.B, setup.w, setup.c);
        const damped = projectCoupled(squashed, setup.B, setup.w, setup.c, { prev: setup.p, relax: 0 });

        expect(moved(bare, damped)).toBe(0);
    });

    it('still leaves rest exactly at rest, however viscous the material', () => {
        // The cancellation survives because the damping scales the whole
        // gradient part by one factor, and a body at rest has no motion for the
        // rate term to bite on. A damping that broke this would reintroduce the
        // drift the block solve exists to remove.
        for (const nu of RATIOS) {
            const setup = restTet(nu);
            const after = projectCoupled(setup.p, setup.B, setup.w, setup.c, { relax: RELAX });

            expect(moved(setup.p, after), `nu = ${nu}`).toBeLessThan(1e-9);
        }
    });

    it('ignores a tetrahedron that is only translating', () => {
        // The whole point of doing this at the constraint rather than on the
        // velocity: `grad C . dx` is `(sum grad C) . dx` for a rigid shift, and
        // every gradient set sums to zero. A falling body is not slowed.
        const setup = restTet(0.35);
        const shifted = setup.p.map(q => add(q, [0.004, -0.011, 0.002]));
        const after = projectCoupled(shifted, setup.B, setup.w, setup.c, { prev: setup.p, relax: RELAX });

        expect(moved(shifted, after)).toBeLessThan(1e-9);
    });

    it('ignores a tetrahedron that is only spinning', () => {
        // Both constraints are invariant under rotation, so their gradients are
        // orthogonal to a rotational velocity field. Unlike translation this is
        // exact only in the limit: the leftover is second order in the angle,
        // where a shear of the same size is first order. So the gap widens as
        // the angle shrinks, and the bound below is a statement about that
        // order, not a tolerance.
        const setup = restTet(0.35);
        const angle = 0.002;
        const spun = setup.p.map(([x, y, z]) => [
            x * Math.cos(angle) - y * Math.sin(angle),
            x * Math.sin(angle) + y * Math.cos(angle),
            z
        ]);
        const after = projectCoupled(spun, setup.B, setup.w, setup.c, { prev: setup.p, relax: RELAX });

        // A shear of the same magnitude, for scale.
        const sheared = setup.p.map(([x, y, z]) => [x + y * angle, y, z]);
        const shearResponse = moved(
            sheared,
            projectCoupled(sheared, setup.B, setup.w, setup.c, { prev: setup.p, relax: RELAX })
        );

        expect(moved(spun, after)).toBeLessThan(shearResponse / 100);
    });

    it('lowers the deformation a struck tetrahedron reaches', () => {
        // A free tetrahedron hit with a shearing velocity, comparing the largest
        // deformation energy reached along the way. Most of that strike turns
        // into rigid motion within a few substeps -- which the damping must not
        // touch -- so a single tetrahedron only shows a few percent, and this
        // asserts the direction rather than the size.
        //
        // The size is a property of a whole body's vibration modes, which needs
        // a lattice sweep rather than one element. Measured that way on a 3x3x3
        // cantilever: at 0.1 s a relaxation of 12 ms leaves a fifth of the ring
        // an elastic material still holds, and by 0.4 s a two-hundredth of it.
        //
        // The direction is the part worth a guard. A sign slip in the rate term
        // would turn this damping into an energy source, and the peak would go
        // up rather than down.
        const setup = restTet(0.35);
        const peak = (relax) => {
            let positions = setup.p;
            let velocity = setup.p.map(([, y]) => [y * 2, 0, 0]);
            let worst = 0;
            for (let s = 0; s < 200; s++) {
                const prev = positions;
                positions = positions.map((q, i) => add(q, scale(velocity[i], DT)));
                positions = projectCoupled(positions, setup.B, setup.w, setup.c, { prev, relax });
                velocity = positions.map((q, i) => scale(sub(q, prev[i]), 1 / DT));
                worst = Math.max(worst, stored(positions, setup));
            }
            return worst;
        };

        expect(peak(0.012 / DT)).toBeLessThan(peak(0) * 0.98);
    });
});

describe('the barrier that is left', () => {
    it('is where collapseScale says it is', () => {
        // Bisect for the largest uniform squash a free tetrahedron still returns
        // from, and compare it with the root of s^3 + s^2 + s = gamma - 1. That
        // agreement is what makes the closed form worth putting in the panel.
        //
        // Only the compressible end is measured this way. Near nu = 0.49 the
        // barrier is at 2% of rest size, where the tetrahedron is degenerate
        // enough that f32 decides the outcome rather than the energy -- and a
        // barrier that far down is not a limit anyone can reach anyway.
        for (const nu of [POISSON_RANGE.min, 0.3, 0.35]) {
            const setup = restTet(nu);
            const rest = volume(setup.p);
            const survives = (factor) => {
                const ratio = volume(run(scaled(setup, factor), projectCoupled, 3000)) / rest;
                return ratio > 0.5 && ratio < 2;
            };

            let ok = 1;
            let lost = 0.05;
            for (let i = 0; i < 18; i++) {
                const mid = (ok + lost) / 2;
                if (survives(mid)) {
                    ok = mid;
                } else {
                    lost = mid;
                }
            }

            expect(ok, `nu = ${nu}`).toBeCloseTo(collapseScale(setup.c.gamma), 2);
        }
    });

    it('sits far enough below rest at every ratio the material allows', () => {
        // gamma = 4 puts the barrier at s = 1, where rest stops being a minimum
        // at all. POISSON_RANGE.min is chosen to keep well clear of it: the
        // worst legal material has to lose five sixths of its volume first.
        for (const nu of RATIOS) {
            const { gamma } = elementCompliance({ ...DEFAULT_MATERIAL, poissonRatio: nu }, { h: H });

            expect(gamma, `nu = ${nu}`).toBeLessThan(4);
            expect(collapseScale(gamma), `nu = ${nu}`).toBeLessThan(0.6);
        }
    });

    it('crosses rest exactly at gamma = 4', () => {
        expect(collapseScale(4)).toBeCloseTo(1, 6);
        expect(collapseScale(2)).toBeCloseTo(0.5437, 3);
        expect(collapseScale(1)).toBeCloseTo(0, 6);
        // Above 4 it is above rest, which is the inflation case the range's
        // lower end exists to exclude.
        expect(collapseScale(5)).toBeGreaterThan(1);
    });
});

describe('the constants the block is built from', () => {
    it('reduce to the Lame parameters the material asked for', () => {
        // alphaDev * mu and alphaHyd * lambda are both 1 / V. That identity is
        // exactly what makes the corrections cancel at rest, so it is worth
        // pinning separately from the projection that relies on it.
        const material = { ...DEFAULT_MATERIAL, poissonRatio: 0.3 };
        const { mu, lambda } = lameParameters(material);
        const { deviatoric, hydrostatic } = elementCompliance(material, { h: H });

        expect((deviatoric * mu) / (hydrostatic * lambda)).toBeCloseTo(1, 12);
        expect(deviatoric * mu).toBeCloseTo(1 / tetRestVolume({ h: H }), 6);
    });
});
