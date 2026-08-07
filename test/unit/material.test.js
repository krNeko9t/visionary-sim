import { describe, expect, it } from 'vitest';

import {
    DEFAULT_MATERIAL,
    POISSON_RANGE,
    engineeringConstants,
    lameParameters,
    waveSpeed
} from '../../src/body/material.js';

describe('material conversion', () => {
    it('round-trips E and nu through the Lame parameters', () => {
        for (const youngsModulus of [1e4, 1.2e5, 5e6]) {
            for (const poissonRatio of [0.25, 0.3, 0.35, 0.4, 0.45, 0.49]) {
                const back = engineeringConstants(lameParameters({ youngsModulus, poissonRatio }));
                expect(back.youngsModulus).toBeCloseTo(youngsModulus, 1);
                expect(back.poissonRatio).toBeCloseTo(poissonRatio, 8);
            }
        }
    });

    it('clamps Poisson ratio away from the degenerate ends', () => {
        // nu = 0.5 diverges lambda; nu = 0 makes gamma infinite and poisons
        // det(F) - gamma with a NaN. The floor sits well above zero anyway --
        // see POISSON_RANGE -- but the clamp is what makes that a guarantee.
        for (const nu of [-1, 0, 0.5, 0.99]) {
            const { mu, lambda } = lameParameters({ youngsModulus: 1e5, poissonRatio: nu });
            expect(Number.isFinite(mu)).toBe(true);
            expect(Number.isFinite(lambda)).toBe(true);
            expect(lambda).toBeGreaterThan(0);

            const back = engineeringConstants({ mu, lambda });
            expect(back.poissonRatio).toBeGreaterThanOrEqual(POISSON_RANGE.min - 1e-9);
            expect(back.poissonRatio).toBeLessThanOrEqual(POISSON_RANGE.max + 1e-9);
        }
    });
});

describe('wave speed', () => {
    it('rises with stiffness and falls with density', () => {
        const base = { ...DEFAULT_MATERIAL, youngsModulus: 1e5, density: 1000 };
        expect(waveSpeed({ ...base, youngsModulus: 1e7 })).toBeGreaterThan(waveSpeed(base));
        expect(waveSpeed({ ...base, density: 4000 })).toBeLessThan(waveSpeed(base));
    });

    it('reports a plausible wave speed for jelly', () => {
        // E = 1e5 Pa at 1000 kg/m^3 is around 10 m/s, which is what sets the
        // 10-substep default at 60 Hz on a 2 cm cell.
        const speed = waveSpeed({ ...DEFAULT_MATERIAL, youngsModulus: 1e5, poissonRatio: 0.35, density: 1000 });
        expect(speed).toBeGreaterThan(5);
        expect(speed).toBeLessThan(30);
    });
});
