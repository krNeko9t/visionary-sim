import { describe, expect, it, vi } from 'vitest';

import {
    freezeForAppend,
    isolateCandidateBodies,
    migrateFrozenState,
    syncCandidateMaterials
} from '../../src/sim/append.js';
import { Simulator } from '../../src/sim/simulator.js';
import { FixedTimestep } from '../../src/sim/solver/timestep.js';

function simBody(id, density = 800) {
    return {
        id,
        instanceId: Number(String(id).replace(/\D/g, '')) || 1,
        body: {
            name: String(id),
            material: {
                density,
                youngsModulus: 1e5,
                poissonRatio: 0.3,
                damping: 0.6,
                friction: 0.4,
                relaxation: 0.012
            }
        },
        lattice: {
            nodeCount: 1,
            restPositions: new Float32Array([0, 0, 0]),
            invMass: new Float32Array([1 / density]),
            cells: new Uint32Array([0]),
            h: 0.1
        }
    };
}

function gpuParticles(prefix) {
    const buffer = name => ({ name: `${prefix}.${name}`, copy: vi.fn() });
    return {
        nodePos: buffer('nodePos'),
        nodePrev: buffer('nodePrev'),
        nodeVel: buffer('nodeVel'),
        reset: vi.fn(),
        uploadMasses: vi.fn(),
        setParams: vi.fn()
    };
}

describe('Simulator append helpers', () => {
    it('isolates mutable material and mass state while sharing immutable rest geometry', () => {
        const existing = simBody('body:7');
        const added = simBody('body:12', 900);

        const candidate = isolateCandidateBodies([existing, added]);

        expect(candidate[0]).not.toBe(existing);
        expect(candidate[0].body).not.toBe(existing.body);
        expect(candidate[0].body.material).not.toBe(existing.body.material);
        expect(candidate[0].lattice).not.toBe(existing.lattice);
        expect(candidate[0].lattice.invMass).not.toBe(existing.lattice.invMass);
        expect(candidate[0].lattice.restPositions).toBe(existing.lattice.restPositions);
        expect(candidate[0].lattice.cells).toBe(existing.lattice.cells);

        candidate[0].body.material.density = 1200;
        candidate[0].lattice.invMass[0] = 0.25;
        expect(existing.body.material.density).toBe(800);
        expect(existing.lattice.invMass[0]).toBeCloseTo(1 / 800);
    });

    it('freezes interaction and waits for submitted GPU work before migration may begin', async () => {
        const order = [];
        let finishGpu;
        const gpuDone = new Promise(resolve => { finishGpu = resolve; });
        const sim = {
            alive: true,
            params: { paused: false },
            pendingStep: true,
            releaseGrab: vi.fn(() => order.push('release')),
            device: {
                submit: vi.fn(() => order.push('submit')),
                wgpu: { queue: { onSubmittedWorkDone: vi.fn(() => gpuDone) } }
            }
        };

        const frozen = freezeForAppend(sim).then(() => order.push('ready'));
        await Promise.resolve();

        expect(sim.appendFrozen).toBe(true);
        expect(sim.params.paused).toBe(true);
        expect(sim.pendingStep).toBe(false);
        expect(order).toEqual(['release', 'submit']);

        finishGpu();
        await frozen;
        expect(order).toEqual(['release', 'submit', 'ready']);
    });

    it('records all old dynamic copies and clones accounting only after the freeze boundary', () => {
        const previousBody = simBody('body:7');
        const addedBody = simBody('body:12');
        const previous = {
            appendFrozen: true,
            params: { paused: true },
            device: {},
            simBodies: [previousBody],
            particles: gpuParticles('old'),
            clock: new FixedTimestep(0.01)
        };
        previous.clock.consume(0.035);
        const before = previous.clock.snapshot();
        const candidate = {
            device: previous.device,
            simBodies: isolateCandidateBodies([previousBody, addedBody]),
            particles: gpuParticles('candidate'),
            clock: new FixedTimestep(0.002),
            params: { paused: false },
            pendingStep: true
        };

        const plan = migrateFrozenState(previous, candidate);

        expect(plan.addedIds).toEqual(['body:12']);
        expect(candidate.clock.snapshot()).toEqual({ ...before, stepDuration: 0.002 });
        expect(previous.clock.snapshot()).toEqual(before);
        expect(candidate.params.paused).toBe(true);
        expect(candidate.pendingStep).toBe(false);
        expect(candidate.particles.reset).toHaveBeenCalledOnce();
        for (const field of ['nodePos', 'nodePrev', 'nodeVel']) {
            expect(candidate.particles[field].copy).toHaveBeenCalledOnce();
        }

        // A real GPU validation probe may advance the unpublished candidate.
        // Re-migration before publication must erase both that step and its
        // effect on newly appended particles.
        candidate.clock.singleStep();
        migrateFrozenState(previous, candidate);
        expect(candidate.clock.snapshot()).toEqual({ ...before, stepDuration: 0.002 });
        expect(candidate.particles.reset).toHaveBeenCalledTimes(2);
        for (const field of ['nodePos', 'nodePrev', 'nodeVel']) {
            expect(candidate.particles[field].copy).toHaveBeenCalledTimes(2);
        }
    });

    it('forces latest materials into candidate-owned CPU and GPU state', () => {
        const body = simBody('body:7');
        const candidate = {
            simBodies: isolateCandidateBodies([body]),
            particles: gpuParticles('candidate'),
            elastic: { uploadParams: vi.fn() },
            setMaterial: vi.fn(function (index, patch) {
                Object.assign(this.simBodies[index].body.material, patch);
            }),
            waveRate: vi.fn(() => 300),
            clock: new FixedTimestep(0.01)
        };

        syncCandidateMaterials(candidate, [{
            bodyId: 'body:7',
            material: { density: 950, youngsModulus: 2e5, poissonRatio: 0.35 }
        }]);

        expect(candidate.setMaterial).toHaveBeenCalledOnce();
        expect(candidate.particles.uploadMasses).toHaveBeenCalledOnce();
        expect(candidate.particles.setParams).toHaveBeenCalledWith(0, {
            damping: 0.6,
            friction: 0.4
        });
        expect(candidate.elastic.uploadParams).toHaveBeenCalledOnce();
        expect(candidate.simBodies[0].body.material.density).toBe(950);
        expect(candidate.clock.stepDuration).toBeCloseTo(0.75 / 300);
        expect(body.body.material.density).toBe(800);
    });

    it('validates every latest material before changing the candidate', () => {
        const candidate = {
            simBodies: isolateCandidateBodies([simBody('body:7'), simBody('body:12')]),
            setMaterial: vi.fn(),
            particles: gpuParticles('candidate'),
            elastic: { uploadParams: vi.fn() },
            clock: new FixedTimestep(0.01),
            waveRate: vi.fn(() => 1)
        };

        expect(() => syncCandidateMaterials(candidate, [
            { bodyId: 'body:7', material: { density: 900, youngsModulus: 2e5, poissonRatio: 0.3 } },
            { bodyId: 'body:12', material: { density: 900, youngsModulus: 2e5, poissonRatio: 0.6 } }
        ])).toThrow(/Poisson/i);

        expect(candidate.setMaterial).not.toHaveBeenCalled();
        expect(candidate.particles.uploadMasses).not.toHaveBeenCalled();
        expect(candidate.elastic.uploadParams).not.toHaveBeenCalled();
    });

    it('exposes a freeze boundary that blocks frames and manual steps without changing the clock', async () => {
        let finishGpu;
        const sim = Object.create(Simulator.prototype);
        Object.assign(sim, {
            alive: true,
            appendFrozen: false,
            params: { paused: false },
            pendingStep: true,
            particles: { nodeCount: 1 },
            clock: new FixedTimestep(0.01),
            dispatch: vi.fn(),
            releaseGrab: vi.fn(),
            device: {
                submit: vi.fn(),
                wgpu: { queue: { onSubmittedWorkDone: () => new Promise(resolve => { finishGpu = resolve; }) } }
            }
        });
        sim.clock.consume(0.015);
        const before = sim.clock.snapshot();

        const freezing = sim.freezeForAppend();
        sim.requestStep();
        sim.step(10);

        expect(sim.pendingStep).toBe(false);
        expect(sim.dispatch).not.toHaveBeenCalled();
        expect(sim.clock.snapshot()).toEqual(before);
        finishGpu();
        await freezing;
    });

    it('creates and owns an isolated Simulator candidate, cleaning it if migration fails', () => {
        const oldBody = simBody('body:7');
        const added = simBody('body:12');
        let receivedBodies;
        let construction = 0;
        const destroyed = vi.fn();
        class CandidateSimulator {
            constructor(device, bodies) {
                receivedBodies = bodies;
                construction++;
                const particles = gpuParticles('candidate');
                if (construction === 2) {
                    particles.nodePrev.copy.mockImplementation(() => { throw new Error('copy failed'); });
                }
                return {
                    device,
                    simBodies: bodies,
                    particles,
                    clock: new FixedTimestep(0.002),
                    params: { paused: true },
                    pendingStep: false,
                    destroy: destroyed
                };
            }
        }
        const previous = Object.create(Simulator.prototype);
        Object.assign(previous, {
            constructor: CandidateSimulator,
            alive: true,
            appendFrozen: true,
            params: { paused: true },
            device: {},
            tank: {},
            simBodies: [oldBody],
            particles: gpuParticles('old'),
            clock: new FixedTimestep(0.01)
        });

        const candidate = previous.createAppendCandidate([added]);
        expect(candidate.simBodies).toHaveLength(2);
        expect(receivedBodies[0].body.material).not.toBe(oldBody.body.material);
        expect(receivedBodies[0].lattice.invMass).not.toBe(oldBody.lattice.invMass);
        expect(destroyed).not.toHaveBeenCalled();

        expect(() => previous.createAppendCandidate([added])).toThrow('copy failed');
        expect(destroyed).toHaveBeenCalledOnce();
    });
});
