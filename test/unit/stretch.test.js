import { describe, expect, it } from 'vitest';
import { stretchCorrection, STRETCH_EDGES } from '../../src/sim/discretize/lattice/stretch.js';
import { CUBE_CORNERS } from '../../src/sim/discretize/lattice/corners.js';

describe('tensile strain limit', () => {
    it('resists lengthening without applying a force to compression or rigid motion', () => {
        const a = [2, 3, 4], b = [2, 4, 4];
        expect(stretchCorrection(a, b, 1, 1, 1.05)).toEqual([0, 0, 0]);
        expect(stretchCorrection(a, [2, 3.5, 4], 1, 1, 1.05)).toEqual([0, 0, 0]);
        const c = stretchCorrection(a, [2, 5, 4], 1, 1, 1.05);
        expect(c[1]).toBeCloseTo(0.475);
    });
    it('gives the full correction to the free end when the other is prescribed', () => {
        const a = [0, 0, 0], b = [2, 0, 0];
        const c = stretchCorrection(a, b, 0, 4, 1.05);
        expect(b[0] - 4 * c[0]).toBeCloseTo(1.05);
        expect(stretchCorrection(a, b, 0, 0, 1.05)).toEqual([0, 0, 0]);
    });
    it('preserves centre of mass and never pushes the ends apart', () => {
        const c = stretchCorrection([0, 0, 0], [2, 0, 0], 2, 1, 1.05);
        const a = c[0] * 2, b = 2 - c[0];
        expect(b - a).toBeCloseTo(1.05);
        expect((a / 2 + b) / 1.5).toBeCloseTo(2 / 1.5);
    });
    it('includes face and body diagonals so shear cannot evade the limit', () => {
        expect(STRETCH_EDGES).toHaveLength(28);
        expect(new Set(STRETCH_EDGES.map(([a, b]) => `${a},${b}`)).size).toBe(28);
        for (const [a, b, length] of STRETCH_EDGES) {
            expect(length).toBeCloseTo(Math.hypot(...CUBE_CORNERS[a].map((v, i) => v - CUBE_CORNERS[b][i])));
        }
    });
});
