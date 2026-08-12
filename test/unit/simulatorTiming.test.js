import { describe, expect, it, vi } from 'vitest';

import { Simulator } from '../../src/sim/simulator.js';
import { FixedTimestep, stableStepDuration } from '../../src/sim/solver/timestep.js';
import { waveRatio } from '../../src/sim/constraints/compliance.js';

/**
 * The public simulator's side of the timing seam, without constructing GPU
 * resources. These objects deliberately contain only what each method is
 * allowed to touch; a new reach into a constraint or buffer makes the test fail
 * instead of quietly becoming another timing owner.
 */
function steppingSimulator({ paused = false, nodes = 1 } = {}) {
    return {
        particles: { nodeCount: nodes },
        params: { paused },
        pendingStep: false,
        clock: new FixedTimestep(0.002),
        dispatch: vi.fn()
    };
}

describe('Simulator owns the timing seam', () => {
    it('turns render dt into a count while dispatching only fixed steps', () => {
        const sim = steppingSimulator();

        Simulator.prototype.step.call(sim, 0.005);
        expect(sim.dispatch).toHaveBeenLastCalledWith(2);
        expect(sim.clock.snapshot().backlogTime).toBeCloseTo(0.001, 12);

        Simulator.prototype.step.call(sim, 0.001);
        expect(sim.dispatch).toHaveBeenLastCalledWith(1);
        expect(sim.clock.snapshot().totalSteps).toBe(3);
    });

    it('does not accumulate paused render frames', () => {
        const sim = steppingSimulator({ paused: true });

        Simulator.prototype.step.call(sim, 10);
        expect(sim.dispatch).not.toHaveBeenCalled();
        expect(sim.clock.snapshot().backlogTime).toBe(0);
        expect(sim.clock.snapshot().droppedTime).toBe(0);
    });

    it('defers one requested quantum to the next legal render frame', () => {
        const sim = steppingSimulator({ paused: true });

        Simulator.prototype.requestStep.call(sim);
        Simulator.prototype.step.call(sim, 10);

        expect(sim.dispatch).toHaveBeenCalledExactlyOnceWith(1);
        expect(sim.pendingStep).toBe(false);
        expect(sim.clock.snapshot().simulatedTime).toBeCloseTo(0.002, 12);
        expect(sim.clock.snapshot().droppedTime).toBe(0);
    });

    it('does no timing work for an all-backdrop scene', () => {
        const sim = steppingSimulator({ nodes: 0 });
        sim.pendingStep = true;

        Simulator.prototype.step.call(sim, 1);

        expect(sim.dispatch).not.toHaveBeenCalled();
        expect(sim.pendingStep).toBe(false);
        expect(sim.clock.snapshot().simulatedTime).toBe(0);
    });

    it('reset clears pending, accumulated, simulated and dropped time', () => {
        const sim = steppingSimulator();
        sim.setGrab = vi.fn();
        sim.particles.reset = vi.fn();
        sim.pendingStep = true;
        sim.clock.consume(0.2);

        Simulator.prototype.reset.call(sim);

        expect(sim.setGrab).toHaveBeenCalledWith(-1, -1);
        expect(sim.particles.reset).toHaveBeenCalledOnce();
        expect(sim.clock.snapshot()).toMatchObject({
            totalSteps: 0,
            simulatedTime: 0,
            backlogTime: 0,
            droppedTime: 0
        });
        expect(sim.pendingStep).toBe(false);
    });

    it('still banks the frame\'s wall time when single-stepped while running', () => {
        const sim = steppingSimulator();

        Simulator.prototype.requestStep.call(sim);
        Simulator.prototype.step.call(sim, 0.0005);

        expect(sim.dispatch).toHaveBeenCalledExactlyOnceWith(1);
        expect(sim.pendingStep).toBe(false);
        // The forced step didn't consume the frame's real elapsed time, so it
        // has to still be sitting in backlog rather than having disappeared.
        expect(sim.clock.snapshot().backlogTime).toBeCloseTo(0.0005, 12);
        expect(sim.clock.snapshot().droppedTime).toBe(0);
    });

    it('does not add an extra step when single-stepping lands on an already-due frame', () => {
        const sim = steppingSimulator();

        Simulator.prototype.requestStep.call(sim);
        Simulator.prototype.step.call(sim, 0.003);

        expect(sim.dispatch).toHaveBeenCalledExactlyOnceWith(1);
        expect(sim.clock.snapshot().backlogTime).toBeCloseTo(0.001, 12);
    });

    it('treats a non-finite or negative dt as no elapsed time instead of throwing', () => {
        const sim = steppingSimulator();

        expect(() => Simulator.prototype.step.call(sim, -1)).not.toThrow();
        expect(() => Simulator.prototype.step.call(sim, NaN)).not.toThrow();
        expect(() => Simulator.prototype.step.call(sim, Number.POSITIVE_INFINITY)).not.toThrow();
        expect(sim.clock.snapshot().backlogTime).toBe(0);
        expect(sim.clock.snapshot().totalSteps).toBe(0);
    });

    it('a material change reconfigures only future fixed steps', () => {
        const material = {
            youngsModulus: 2e3,
            poissonRatio: 0.4,
            density: 700,
            damping: 0.6,
            friction: 0.5,
            relaxation: 0.012
        };
        const lattice = { h: 0.015, invMass: new Float32Array([1]) };
        const sim = {
            simBodies: [{ body: { material }, lattice }],
            particles: { setParams: vi.fn(), uploadMasses: vi.fn() },
            elastic: { uploadParams: vi.fn() },
            clock: new FixedTimestep(stableStepDuration(waveRatio(material, lattice))),
            worst: Simulator.prototype.worst,
            waveRate: Simulator.prototype.waveRate
        };
        sim.clock.consume(sim.clock.stepDuration / 2);
        const backlog = sim.clock.snapshot().backlogTime;
        const previous = sim.clock.stepDuration;

        Simulator.prototype.setMaterial.call(sim, 0, { youngsModulus: 1e5 });

        expect(sim.clock.stepDuration).toBeLessThan(previous);
        expect(sim.clock.snapshot().backlogTime).toBe(backlog);
        expect(sim.particles.setParams).toHaveBeenCalledOnce();
        expect(sim.elastic.uploadParams).toHaveBeenCalledOnce();
    });
});
