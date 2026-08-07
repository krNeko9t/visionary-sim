import { describe, expect, it } from 'vitest';

import { DEFAULT_MATERIAL, POISSON_RANGE, waveSpeed } from '../../src/body/material.js';
import { collapseScale, elementCompliance, waveRatio } from '../../src/sim/constraints/compliance.js';

/** A stand-in lattice: only the cell size reaches the compliance maths. */
const cell = h => ({ h });

describe('element compliance', () => {
    it('keeps gamma clear of where rest stops being a minimum', () => {
        // gamma = 4 is where the energy's second stationary point reaches
        // s = 1 and rest becomes a maximum. The legal range has to stay under
        // it with room to spare, since the barrier is a real deformation a body
        // can be pushed through. See collapseScale and the POISSON_RANGE
        // comment in body/material.js.
        const worst = elementCompliance({ ...DEFAULT_MATERIAL, poissonRatio: POISSON_RANGE.min }, cell(0.02));

        expect(worst.gamma).toBeLessThan(4);
        expect(collapseScale(worst.gamma)).toBeLessThan(0.6);
    });

    it('makes stiffer materials less compliant', () => {
        const soft = elementCompliance({ ...DEFAULT_MATERIAL, youngsModulus: 1e4 }, cell(0.02));
        const stiff = elementCompliance({ ...DEFAULT_MATERIAL, youngsModulus: 1e6 }, cell(0.02));

        expect(stiff.deviatoric).toBeLessThan(soft.deviatoric);
        expect(stiff.hydrostatic).toBeLessThan(soft.hydrostatic);
        for (const value of [...Object.values(soft), ...Object.values(stiff)]) {
            expect(Number.isFinite(value)).toBe(true);
        }
    });

    it('drives gamma towards 1 as the material becomes incompressible', () => {
        const compressible = elementCompliance({ ...DEFAULT_MATERIAL, poissonRatio: 0.36 }, cell(0.02));
        const incompressible = elementCompliance({ ...DEFAULT_MATERIAL, poissonRatio: 0.49 }, cell(0.02));

        expect(incompressible.gamma).toBeLessThan(compressible.gamma);
        expect(incompressible.gamma).toBeGreaterThan(1);
        expect(incompressible.gamma).toBeLessThan(1.1);
    });

    it('softens compliance as the elements get bigger', () => {
        const fine = elementCompliance(DEFAULT_MATERIAL, cell(0.01));
        const coarse = elementCompliance(DEFAULT_MATERIAL, cell(0.02));
        // alpha = 1 / (mu * V) and V scales with h^3, so doubling h divides the
        // compliance by eight. Getting this wrong changes the effective
        // stiffness whenever the resolution changes.
        expect(fine.deviatoric / coarse.deviatoric).toBeCloseTo(8, 6);
    });
});

describe('waveRatio', () => {
    it('is the wave speed measured in cells per second', () => {
        expect(waveRatio(DEFAULT_MATERIAL, cell(0.02)))
            .toBeCloseTo(waveSpeed(DEFAULT_MATERIAL) / 0.02, 6);
    });

    it('lets coarse cells carry a stiffer material than fine cells can', () => {
        // The reason this is not a property of the material alone: stiffness
        // does not decide the substep cost, its ratio to the cell size does. A
        // stiff body in coarse cells can be cheaper to step than a soft one in
        // fine cells, so the scene's requirement has to be evaluated per body
        // rather than by pairing the worst material with the worst cell.
        const stiff = { ...DEFAULT_MATERIAL, youngsModulus: 4e5 };
        const soft = { ...DEFAULT_MATERIAL, youngsModulus: 4e4 };

        expect(waveSpeed(stiff)).toBeGreaterThan(waveSpeed(soft));
        expect(waveRatio(stiff, cell(0.04))).toBeLessThan(waveRatio(soft, cell(0.005)));
    });
});
