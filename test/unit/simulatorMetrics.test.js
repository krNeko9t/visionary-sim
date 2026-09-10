import { describe, expect, it, vi } from 'vitest';

import { sphere } from '../../src/assets/shapes.js';
import { SoftBody } from '../../src/body/softBody.js';
import { discretizeBody } from '../../src/sim/discretize/discretize.js';
import { Simulator } from '../../src/sim/simulator.js';
import { FixedTimestep } from '../../src/sim/solver/timestep.js';

function preparedBody(id, resolution, density) {
    const body = new SoftBody({
        name: `body-${id}`,
        source: { kind: 'shape', shape: sphere({ radius: 0.1 }) },
        material: { density },
        resolution
    });
    return { id, body, lattice: discretizeBody(body) };
}

function simulator(bodies) {
    return Object.assign(Object.create(Simulator.prototype), {
        simBodies: bodies,
        particles: { uploadMasses: vi.fn(), setParams: vi.fn() },
        elastic: { uploadParams: vi.fn() },
        clock: new FixedTimestep(0.001)
    });
}

describe('Simulator current body metrics', () => {
    it('reports current mass after a real material update without changing volume or another body', () => {
        const sim = simulator([preparedBody(7, 4, 800), preparedBody(12, 6, 900)]);
        const before = sim.metricsOf(7);
        const other = sim.metricsOf(12);

        sim.setMaterial(sim.bodyIndexOf(7), { density: 1600 });

        const after = sim.metricsOf(7);
        expect(after.mass).toBeCloseTo(before.volume * 1600, 10);
        expect(after.mass).toBeCloseTo(before.mass * 2, 10);
        expect(after).toEqual({ ...before, mass: after.mass });
        expect(sim.metricsOf(12)).toEqual(other);
        expect(before.mass).toBeCloseTo(before.volume * 800, 10);
        expect(sim.particles.uploadMasses).toHaveBeenCalledOnce();
    });

    it('resolves numeric and string IDs across reordered bodies and exposes their actual discretization', () => {
        const first = preparedBody(7, 4, 800);
        const second = preparedBody('7', 6, 900);
        const sim = simulator([second, first]);

        for (const { id, body, lattice } of [first, second]) {
            expect(sim.metricsOf(id)).toEqual({
                volume: lattice.volume,
                mass: lattice.mass,
                nodes: lattice.nodeCount,
                occupiedCells: lattice.cells.length,
                resolution: body.resolution
            });
        }
        sim.simBodies.reverse();
        expect(sim.metricsOf(7).resolution).toBe(4);
        expect(sim.metricsOf('7').resolution).toBe(6);
        expect(sim.metricsOf(0)).toBeNull();
        expect(sim.metricsOf('missing')).toBeNull();
    });

    it('reports the latest mass after candidate publication synchronizes materials', () => {
        const sim = simulator([preparedBody(7, 4, 800)]);
        const before = sim.metricsOf(7);

        sim.syncCandidateMaterials([{
            bodyId: 7,
            material: { density: 900, youngsModulus: 1e5, poissonRatio: 0.3 }
        }]);

        expect(sim.metricsOf(7).mass).toBeCloseTo(before.volume * 900, 10);
        expect(sim.metricsOf(7).volume).toBe(before.volume);
    });
});
