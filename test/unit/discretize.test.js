import { describe, expect, it } from 'vitest';

import { DEFAULT_MATERIAL } from '../../src/body/material.js';
import { SoftBody } from '../../src/body/softBody.js';
import { sphere } from '../../src/assets/shapes.js';
import { discretizeBody, relumpMasses } from '../../src/sim/discretize/discretize.js';

/**
 * @param {Partial<import('../../src/body/material.js').Material>} [material] - Overrides.
 * @param {number} [resolution] - Requested detail.
 * @returns {import('../../src/sim/discretize/lattice.js').Lattice} Its lattice.
 */
function latticeOf(material = {}, resolution = 8) {
    const body = new SoftBody({
        name: 'test',
        source: { kind: 'shape', shape: sphere({ radius: 0.05 }) },
        material,
        resolution
    });
    return discretizeBody(body);
}

describe('discretizeBody', () => {
    it('builds a lattice from a body without the body knowing how', () => {
        const lattice = latticeOf();
        expect(lattice.cells.length).toBeGreaterThan(0);
        expect(lattice.nodeCount).toBeGreaterThan(lattice.cells.length);
        expect(lattice.mass).toBeCloseTo(DEFAULT_MATERIAL.density * lattice.volume, 6);
    });

    it('gives a finer request smaller cells', () => {
        expect(latticeOf({}, 16).h).toBeLessThan(latticeOf({}, 6).h);
    });
});

describe('relumpMasses', () => {
    it('keeps node masses consistent with density times volume', () => {
        const lattice = latticeOf({ density: 1000 });
        const before = lattice.mass;

        relumpMasses(lattice, 1000, 2000);
        expect(lattice.mass).toBeCloseTo(before * 2, 6);

        let lumped = 0;
        for (const inv of lattice.invMass) {
            if (inv > 0) {
                lumped += 1 / inv;
            }
        }
        expect(lumped).toBeCloseTo(lattice.mass, 6);
        expect(lattice.mass).toBeCloseTo(2000 * lattice.volume, 6);
    });

    it('leaves nodes with no material inert at any density', () => {
        const lattice = latticeOf();
        const inertBefore = [...lattice.invMass].filter(m => m === 0).length;

        relumpMasses(lattice, DEFAULT_MATERIAL.density, 500);
        expect([...lattice.invMass].filter(m => m === 0).length).toBe(inertBefore);
    });

    it('round-trips back to the original masses', () => {
        // Density is applied as a ratio against the previous value, so a
        // sequence of edits must not accumulate drift -- the UI slider will
        // produce hundreds of them.
        const lattice = latticeOf({ density: 1000 });
        const snapshot = Float32Array.from(lattice.invMass);

        let previous = 1000;
        for (const density of [1500, 700, 2400, 1000]) {
            relumpMasses(lattice, previous, density);
            previous = density;
        }

        for (let n = 0; n < snapshot.length; n++) {
            expect(lattice.invMass[n]).toBeCloseTo(snapshot[n], 3);
        }
    });
});
