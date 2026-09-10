import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Appending a body to a running simulation, at the seam where it is decided --
 * not in the GPU classes it rebuilds.
 *
 * Every resource the arena is made of is replaced by a recorder, because what
 * this file is about is the *order*: a candidate is filled from the running
 * scene, nothing switches until the commit, and exactly one of the two arenas
 * is destroyed whichever way it ends. Getting that order wrong is what turns an
 * append back into the rebuild it exists to avoid, and it would not show up as
 * an exception -- it would show up as a chair snapping back to its rest pose
 * when a table joined.
 */

/** Every arena piece ever constructed, in construction order. */
const built = [];

/**
 * @param {string} kind - Which piece this stands in for.
 * @returns {Function} A constructor that records itself.
 */
function recorder(kind) {
    return class {
        constructor(...args) {
            this.kind = kind;
            this.args = args;
            this.destroy = vi.fn();
            built.push(this);
        }
    };
}

vi.mock('../../src/sim/state/particles.js', () => ({
    STATE_WGSL: '',
    Particles: class {
        constructor(device, bodies) {
            this.kind = 'particles';
            this.bodies = bodies;
            this.nodeCount = bodies.reduce((sum, { nodeCount }) => sum + nodeCount, 0);
            this.nodePos = { id: `pos-${built.length}` };
            this.adopt = vi.fn();
            this.setParams = vi.fn();
            this.destroy = vi.fn();
            built.push(this);
        }

        offsetOf(index) {
            return this.bodies.slice(0, index).reduce((sum, { nodeCount }) => sum + nodeCount, 0);
        }
    }
}));
vi.mock('../../src/sim/constraints/kinematicDrive.js', () => ({ KinematicDrive: recorder('drive') }));
vi.mock('../../src/sim/constraints/elasticCells.js', () => ({ ElasticCells: recorder('elastic') }));
vi.mock('../../src/sim/constraints/bodyContact.js', () => ({ BodyContact: recorder('contact') }));
vi.mock('../../src/sim/solver/stepper.js', () => ({ Stepper: recorder('stepper') }));
vi.mock('../../src/sim/discretize/discretize.js', () => ({
    discretizeBody: body => ({ nodeCount: body.nodeCount, h: 0.1 }),
    relumpMasses: vi.fn()
}));

const { Simulator } = await import('../../src/sim/simulator.js');

/** A material stiff enough to be a plausible scene member, and nothing else. */
const material = { damping: 0.1, friction: 0.3 };

/**
 * A simulator with a running arena, assembled from the recorders above.
 *
 * @param {object} [options] - Overrides.
 * @param {number} [options.nodeCount] - Nodes the one existing body has.
 * @returns {object} Something `prepareAppend` can be called on.
 */
function running({ nodeCount = 4 } = {}) {
    const simBodies = [{ body: { name: 'chair', material, nodeCount }, lattice: { nodeCount, h: 0.1 } }];
    const sim = {
        device: { id: 'device' },
        tank: { min: [-1, -1, -1], max: [1, 1, 1] },
        simBodies,
        clock: { setStepDuration: vi.fn() },
        pendingStep: true,
        releaseGrab: vi.fn(),
        install: Simulator.prototype.install,
        deformationOf: Simulator.prototype.deformationOf,
        waveRate: () => 120
    };
    Simulator.prototype.install.call(sim, {
        particles: {
            kind: 'live',
            nodeCount,
            nodePos: { id: 'pos-live' },
            offsetOf: () => 0,
            setParams: vi.fn(),
            destroy: vi.fn(),
            snapshot: vi.fn(async () => ({
                nodeCount,
                positions: new Float32Array(nodeCount * 4).fill(7),
                previous: new Float32Array(nodeCount * 4).fill(6),
                velocities: new Float32Array(nodeCount * 4).fill(5)
            }))
        },
        drive: { destroy: vi.fn(), law: 'hard' },
        elastic: { destroy: vi.fn() },
        contact: { destroy: vi.fn(), enabled: true },
        stepper: { destroy: vi.fn() }
    });
    return sim;
}

/** @returns {object[]} The pieces built since the last reset, newest arena last. */
const arenaPieces = () => built.filter(piece => piece.kind !== 'live');

beforeEach(() => {
    built.length = 0;
});

describe('appending a body to a running simulation', () => {
    it('fills the candidate from the running scene and switches nothing yet', async () => {
        const sim = running({ nodeCount: 4 });
        const live = sim.particles;

        const candidate = await Simulator.prototype.prepareAppend.call(
            sim, { name: 'table', material, nodeCount: 3 }
        );

        expect(live.snapshot).toHaveBeenCalledOnce();
        const [particles] = arenaPieces();
        expect(particles.nodeCount).toBe(7);
        expect(particles.adopt).toHaveBeenCalledOnce();
        expect(particles.adopt.mock.calls[0][0].positions[0]).toBe(7);

        // Still the old arena, still the old body list, nothing destroyed.
        expect(sim.particles).toBe(live);
        expect(sim.simBodies).toHaveLength(1);
        expect(live.destroy).not.toHaveBeenCalled();
        expect(candidate.bodyIndex).toBe(1);
    });

    it('ends the grab before reading the scene back', async () => {
        const sim = running();
        await Simulator.prototype.prepareAppend.call(sim, { name: 'table', material, nodeCount: 3 });
        expect(sim.releaseGrab).toHaveBeenCalledOnce();
    });

    it('hands out candidate fields against the buffers the commit will keep', async () => {
        const sim = running({ nodeCount: 4 });
        const candidate = await Simulator.prototype.prepareAppend.call(
            sim, { name: 'table', material, nodeCount: 3 }
        );
        const [particles] = arenaPieces();

        const field = candidate.deformationOf(1);
        expect(field.parameters.deformNodePos).toBe(particles.nodePos);
        // Appended at the end, so the body already running keeps its offset.
        expect(field.parameters.deformNodeOffset).toBe(4);
        expect(candidate.deformationOf(0).parameters.deformNodeOffset).toBe(0);
    });

    it('swaps both arenas at the commit and destroys only the old one', async () => {
        const sim = running();
        const old = { particles: sim.particles, stepper: sim.stepper, contact: sim.contact };
        sim.contact.enabled = false;
        sim.drive.law = 'compliant';

        const candidate = await Simulator.prototype.prepareAppend.call(
            sim, { name: 'table', material, nodeCount: 3 }
        );
        const pieces = arenaPieces();
        expect(candidate.commit()).toBe(1);

        expect(sim.simBodies).toHaveLength(2);
        expect(sim.particles).toBe(pieces[0]);
        expect(pieces.every(piece => !piece.destroy.mock.calls.length)).toBe(true);
        expect(old.particles.destroy).toHaveBeenCalledOnce();
        expect(old.stepper.destroy).toHaveBeenCalledOnce();
        expect(old.contact.destroy).toHaveBeenCalledOnce();

        // Settings a fresh arena cannot know, carried across.
        expect(sim.contact.enabled).toBe(false);
        expect(sim.drive.law).toBe('compliant');
        // Both bodies' node parameters re-derived from their materials.
        expect(sim.particles.setParams).toHaveBeenCalledTimes(2);
        // A stiffer member may shorten the step; a banked one belonged to the old arena.
        expect(sim.clock.setStepDuration).toHaveBeenCalledOnce();
        expect(sim.pendingStep).toBe(false);
    });

    it('destroys only the candidate when it is cancelled', async () => {
        const sim = running();
        const live = sim.particles;
        const candidate = await Simulator.prototype.prepareAppend.call(
            sim, { name: 'table', material, nodeCount: 3 }
        );
        const pieces = arenaPieces();

        candidate.cancel();

        expect(pieces.every(piece => piece.destroy.mock.calls.length === 1)).toBe(true);
        expect(live.destroy).not.toHaveBeenCalled();
        expect(sim.particles).toBe(live);
        expect(sim.simBodies).toHaveLength(1);
    });

    it('refuses to settle twice', async () => {
        const sim = running();
        const candidate = await Simulator.prototype.prepareAppend.call(
            sim, { name: 'table', material, nodeCount: 3 }
        );

        candidate.commit();
        expect(() => candidate.commit()).toThrow(/already committed or cancelled/);
        // A cancel arriving late must not destroy the arena now in use.
        candidate.cancel();
        expect(sim.particles.destroy).not.toHaveBeenCalled();
    });
});
