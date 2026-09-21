import { describe, expect, it } from 'vitest';

import { DEFAULT_MATERIAL } from '../../src/body/material.js';
import { SoftBody } from '../../src/body/softBody.js';
import { box, sphere } from '../../src/assets/shapes.js';
import { discretizeBody } from '../../src/sim/discretize/discretize.js';

/**
 * Gaussians scattered over the faces of a cube, standing in for a capture.
 *
 * @param {number} half - Half extent of the cube.
 * @returns {import('../../src/assets/splats/cloud.js').SplatCloud} The cloud.
 */
function cloudOnCube(half) {
    const points = [];
    const steps = 12;
    for (let axis = 0; axis < 3; axis++) {
        for (let side = -1; side <= 1; side += 2) {
            for (let u = 0; u <= steps; u++) {
                for (let v = 0; v <= steps; v++) {
                    const at = [(u / steps * 2 - 1) * half, (v / steps * 2 - 1) * half, side * half];
                    points.push(at[(3 - axis) % 3], at[(4 - axis) % 3], at[(5 - axis) % 3]);
                }
            }
        }
    }

    const count = points.length / 3;
    const cloud = {
        count,
        positions: Float32Array.from(points),
        rotations: new Float32Array(count * 4),
        scales: new Float32Array(count * 3).fill(half / 40),
        opacity: new Float32Array(count).fill(1),
        colors: new Float32Array(count * 3).fill(0.5)
    };
    for (let i = 0; i < count; i++) {
        cloud.rotations[i * 4 + 3] = 1;
    }
    return cloud;
}

/**
 * @param {Partial<import('../../src/body/material.js').Material>} [material] - Overrides.
 * @param {number} [resolution] - Requested detail.
 * @returns {import('../../src/sim/discretize/lattice/voxelLattice.js').VoxelLattice} Its proxy.
 */
function proxyOf(material = {}, resolution = 8) {
    const body = new SoftBody({
        name: 'test',
        source: { kind: 'shape', shape: sphere({ radius: 0.05 }) },
        material,
        resolution
    });
    return /** @type {any} */ (discretizeBody(body));
}

describe('discretizeBody', () => {
    it('builds a lattice from a body without the body knowing how', () => {
        const { lattice } = proxyOf();
        expect(lattice.cells.length).toBeGreaterThan(0);
        expect(lattice.nodeCount).toBeGreaterThan(lattice.cells.length);
        expect(lattice.mass).toBeCloseTo(DEFAULT_MATERIAL.density * lattice.volume, 6);
    });

    it('gives a finer request smaller cells', () => {
        expect(proxyOf({}, 16).spacing.min).toBeLessThan(proxyOf({}, 6).spacing.min);
    });

    it('takes every kind of rest geometry there is', () => {
        // The point of the table this dispatches through: a third way of
        // describing an object arrived and nothing above this file moved. What
        // is asserted is only that each kind reaches a lattice with material in
        // it -- what each one does with the geometry belongs to its own test.
        const cube = box({ halfExtents: [0.04, 0.04, 0.04] });
        const sources = [
            { kind: 'shape', shape: cube },
            { kind: 'mesh', mesh: cube.surface },
            { kind: 'cloud', cloud: cloudOnCube(0.04) }
        ];

        for (const source of sources) {
            const { lattice } = discretizeBody(new SoftBody({ name: source.kind, source, resolution: 8 }));
            expect(lattice.cells.length, source.kind).toBeGreaterThan(0);
            expect(lattice.volume, source.kind).toBeGreaterThan(0);
        }
    });

    it('refuses rest geometry it has never heard of', () => {
        const body = new SoftBody({ name: 'mystery', source: { kind: 'hologram' } });
        expect(() => discretizeBody(body)).toThrow(/hologram/);
    });
});

describe('setDensity', () => {
    it('keeps node masses consistent with density times volume', () => {
        const proxy = proxyOf({ density: 1000 });
        const { lattice } = proxy;
        const before = lattice.mass;

        proxy.setDensity(1000, 2000);
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
        const proxy = proxyOf();
        const { invMass } = proxy.dof;
        const inertBefore = [...invMass].filter(m => m === 0).length;

        proxy.setDensity(DEFAULT_MATERIAL.density, 500);
        expect([...invMass].filter(m => m === 0).length).toBe(inertBefore);
    });

    it('round-trips back to the original masses', () => {
        // Density is applied as a ratio against the previous value, so a
        // sequence of edits must not accumulate drift -- the UI slider will
        // produce hundreds of them.
        const proxy = proxyOf({ density: 1000 });
        const { invMass } = proxy.dof;
        const snapshot = Float32Array.from(invMass);

        let previous = 1000;
        for (const density of [1500, 700, 2400, 1000]) {
            proxy.setDensity(previous, density);
            previous = density;
        }

        for (let n = 0; n < snapshot.length; n++) {
            expect(invMass[n]).toBeCloseTo(snapshot[n], 3);
        }
    });
});
