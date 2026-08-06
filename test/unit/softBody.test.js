import { describe, expect, it } from 'vitest';

import { SoftBody } from '../../src/body/softBody.js';
import { DEFAULT_MATERIAL, waveSpeed } from '../../src/body/material.js';
import { buildLattice } from '../../src/geometry/lattice.js';
import { sphere } from '../../src/geometry/shapes.js';
import { voxelizeSdf } from '../../src/geometry/voxelize.js';

/**
 * @param {Partial<import('../../src/body/material.js').Material>} [material] - Overrides.
 * @param {number} [resolution] - Lattice cells along the longest axis.
 * @returns {SoftBody} A test body.
 */
function makeBody(material = {}, resolution = 8) {
    const resolved = { ...DEFAULT_MATERIAL, ...material };
    const grid = voxelizeSdf(sphere({ radius: 0.05 }), { resolution });
    return new SoftBody({
        name: 'test',
        lattice: buildLattice(grid, { density: resolved.density }),
        material: resolved
    });
}

describe('waveRatio', () => {
    it('is the wave speed measured in cells per second', () => {
        const body = makeBody();
        expect(body.waveRatio).toBeCloseTo(waveSpeed(body.material) / body.lattice.h, 6);
    });

    it('lets coarse cells carry a stiffer material than fine cells can', () => {
        // The reason this lives on the body and not on the material: stiffness
        // alone does not decide the substep cost, the ratio to the cell size
        // does. A stiff body in coarse cells can be cheaper to step than a soft
        // one in fine cells, so the scene's requirement has to be evaluated per
        // body rather than by pairing the worst material with the worst cell.
        const stiffCoarse = makeBody({ youngsModulus: 4e5 }, 6);
        const softFine = makeBody({ youngsModulus: 4e4 }, 24);

        expect(stiffCoarse.lattice.h).toBeGreaterThan(softFine.lattice.h);
        expect(waveSpeed(stiffCoarse.material)).toBeGreaterThan(waveSpeed(softFine.material));
        expect(stiffCoarse.waveRatio).toBeLessThan(softFine.waveRatio);
    });
});

describe('setDensity', () => {
    it('keeps node masses consistent with density times volume', () => {
        const body = makeBody({ density: 1000 });
        const before = body.lattice.mass;

        expect(body.setDensity(2000)).toBe(true);
        expect(body.material.density).toBe(2000);
        expect(body.lattice.mass).toBeCloseTo(before * 2, 6);

        let lumped = 0;
        for (const inv of body.lattice.invMass) {
            if (inv > 0) {
                lumped += 1 / inv;
            }
        }
        expect(lumped).toBeCloseTo(body.lattice.mass, 6);
        expect(body.lattice.mass).toBeCloseTo(2000 * body.lattice.volume, 6);
    });

    it('leaves nodes with no material inert at any density', () => {
        const body = makeBody();
        const inertBefore = [...body.lattice.invMass].filter(m => m === 0).length;

        body.setDensity(500);
        expect([...body.lattice.invMass].filter(m => m === 0).length).toBe(inertBefore);
    });

    it('reports no change, and touches nothing, for a no-op or invalid density', () => {
        const body = makeBody({ density: 1000 });
        const snapshot = Float32Array.from(body.lattice.invMass);

        for (const density of [1000, 0, -5, NaN]) {
            expect(body.setDensity(density)).toBe(false);
        }
        expect(body.material.density).toBe(1000);
        expect(body.lattice.invMass).toEqual(snapshot);
    });

    it('round-trips back to the original masses', () => {
        // Density is applied as a ratio against the previous value, so a
        // sequence of edits must not accumulate drift -- the UI slider will
        // produce hundreds of them.
        const body = makeBody({ density: 1000 });
        const snapshot = Float32Array.from(body.lattice.invMass);

        for (const density of [1500, 700, 2400, 1000]) {
            body.setDensity(density);
        }

        for (let n = 0; n < snapshot.length; n++) {
            expect(body.lattice.invMass[n]).toBeCloseTo(snapshot[n], 3);
        }
    });
});
