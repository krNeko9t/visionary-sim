import { describe, expect, it, vi } from 'vitest';

import { Particles } from '../../src/sim/state/particles.js';
import { Simulator } from '../../src/sim/simulator.js';
import { sphere } from '../../src/assets/shapes.js';
import { BodyContact } from '../../src/sim/constraints/bodyContact.js';
import { SoftBody } from '../../src/body/softBody.js';
import { staticNodesInRegion } from '../../src/sim/staticPrescription.js';

// The declaration receives world positions, never node indices or proxy data.
describe('static prescription at rest', () => {
    it('classifies synthetic positions with the body declaration', () => {
        const body = new SoftBody({
            name: 'support', source: null,
            staticRegion: (x, y, z) => x < 0 && y <= 2 && z === 3
        });
        const positions = Float32Array.from([-1, 2, 3, 1, 2, 3, -1, 3, 3, -2, 1, 3]);
        expect(staticNodesInRegion(positions, body.staticRegion)).toEqual([0, 3]);
        expect(staticNodesInRegion(positions)).toEqual([]);
        expect(staticNodesInRegion(positions, () => true)).toEqual([0, 1, 2, 3]);
        expect(staticNodesInRegion(new Float32Array(), body.staticRegion)).toEqual([]);
    });
});

// Only the external GPU boundary is replaced. Body, discretisation, state,
// constraints and Simulator below are the production implementations.
vi.mock('playcanvas', async importOriginal => {
    const original = await importOriginal();
    return {
        ...original,
        StorageBuffer: class {
            constructor(device, size) {
                this.bytes = new Uint8Array(size);
                this.writes = [];
            }
            write(offset, data) {
                const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
                this.bytes.set(bytes, offset);
                this.writes.push(this.bytes.slice());
            }
            async read(offset, size, target) {
                new Uint8Array(target.buffer, target.byteOffset, size).set(this.bytes.subarray(offset, offset + size));
            }
            destroy() {}
        },
        Shader: class { destroy() {} },
        Compute: class {
            setParameter() {}
            setupDispatch() {}
            destroy() {}
        }
    };
});


const floats = buffer => Array.from(new Float32Array(buffer.bytes.buffer));
const nodes = (positions, masses, staticNodes = []) => ({
    restPositions: Float32Array.from(positions),
    invMass: Float32Array.from(masses),
    nodeCount: masses.length,
    staticNodes
});

describe('static and kinematic prescription have separate lifetimes', () => {
    it('composes the first upload and overlapping prescriptions without changing material masses', () => {
        const bodies = [
            nodes([0, 0, 0, 1, 0, 0], [2, 0], [1]),
            nodes([2, 0, 0, 3, 0, 0, 4, 0, 0], [3, 4, 5], [0, 2])
        ];
        const particles = new Particles({}, bodies);
        expect(Array.from(new Float32Array(particles.nodeInvMass.writes[0].buffer))).toEqual([2, 0, 0, 4, 0]);
        expect([...particles.staticPrescribed]).toEqual([1, 2, 4]);
        expect(particles.materialCounts(0)).toEqual({ materialNodes: 1, staticNodes: 0, movableNodes: 1 });
        expect(particles.materialCounts(1)).toEqual({ materialNodes: 3, staticNodes: 2, movableNodes: 1 });

        particles.setPrescribed([2, 3]);
        expect(floats(particles.nodeInvMass)).toEqual([2, 0, 0, 0, 0]);
        bodies[1].invMass.set([6, 8, 10]);
        particles.uploadMasses();
        expect(Array.from(particles.invMass)).toEqual([2, 0, 6, 8, 10]);
        expect(floats(particles.nodeInvMass)).toEqual([2, 0, 0, 0, 0]);
        particles.clearPrescribed();
        expect(floats(particles.nodeInvMass)).toEqual([2, 0, 0, 8, 0]);
        particles.nodePos.write(0, new Float32Array(20).fill(9));
        particles.nodeVel.write(0, new Float32Array(20).fill(7));
        particles.reset();
        expect(floats(particles.nodePos)).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0]);
        expect(floats(particles.nodePrev)).toEqual(floats(particles.nodePos));
        expect(floats(particles.nodeVel)).toEqual(new Array(20).fill(0));
        expect(floats(particles.nodeInvMass)).toEqual([2, 0, 0, 8, 0]);
        expect(Array.from(bodies[1].invMass)).toEqual([6, 8, 10]);
        particles.destroy();
    });
});


const bounds = { min: [-0.2, -0.2, -0.2], max: [0.2, 0.2, 0.2] };
const device = { supportsCompute: true, deviceType: 'test' };
const body = (staticRegion, elementSize = 0.02) => new SoftBody({
    name: 'synthetic sphere',
    source: { kind: 'shape', shape: sphere({ radius: 0.04 }) },
    staticRegion,
    elementSize
});

describe('public grabbing respects body-owned static material', () => {
    it('configures finite grip strength without changing prescription and rejects invalid updates atomically', () => {
        const sim = new Simulator(device, [body((x, y, z) => z < 0)], bounds);
        try {
            const staticNodes = [...sim.particles.staticPrescribed];
            expect(sim.driveLaw).toBe('hard');
            sim.setDriveLaw('compliant');
            sim.setDriveResponseTime(0.003);
            expect(sim.driveLaw).toBe('compliant');
            expect(sim.drive.responseTime).toBe(0.003);
            expect([...sim.particles.staticPrescribed]).toEqual(staticNodes);
            for (const value of [0, -1, NaN, Infinity]) expect(() => sim.setDriveResponseTime(value)).toThrow(/responseTime/);
            expect(sim.drive.responseTime).toBe(0.003);
            expect(() => sim.setMaterial(0, { maxStretch: 0.5 })).toThrow(/maxStretch/);
            expect(sim.simBodies[0].body.material.maxStretch).toBe(0);
        } finally { sim.destroy(); }
    });
    it.each(['hard', 'compliant'])('rejects a direct %s hold containing static nodes before changing the active hold', law => {
        const sim = new Simulator(device, [body((x, y, z) => z < 0)], bounds);
        sim.setDriveLaw(law);
        const fixed = [...sim.particles.staticPrescribed].find(n => sim.particles.invMass[n] > 0);
        const movable = Array.from(sim.particles.invMass.keys()).find(n => sim.particles.invMass[n] > 0 && !sim.particles.staticPrescribed.has(n));
        sim.drive.hold([movable], [[0, 0, 0]]);
        const before = sim.drive.driven.bytes.slice();
        expect(() => sim.drive.hold([movable, fixed], [[0, 0, 0], [1, 0, 0]])).toThrow(/static/);
        expect(sim.drive.driven.bytes).toEqual(before);
        expect(sim.drive.drivenCount).toBe(1);
        expect(sim.drive.heldNodes).toEqual([movable]);
        sim.destroy();
    });

    it.each(['hard', 'compliant'])('uploads only movable material for %s and preserves it across law changes and regrabs', async law => {
        const sim = new Simulator(device, [body((x, y, z) => z < 0)], bounds);
        sim.setDriveLaw(law);
        const material = sim.particles.invMass.slice();
        const ray = [[0, 0, -0.2], [0, 0, 1]];
        const hit = await sim.grab(...ray);
        expect(hit.held).toBeGreaterThan(1);
        expect(hit.position[2]).toBeGreaterThanOrEqual(0);
        const held = () => {
            const uploaded = new Uint32Array(sim.drive.driven.bytes.buffer);
            return Array.from({ length: sim.drive.drivenCount }, (_, i) => uploaded[i * 8]);
        };
        const initial = held();
        expect(initial.every(n => material[n] > 0 && !sim.particles.staticPrescribed.has(n))).toBe(true);
        // The sphere actually overlaps static material: this is not an empty
        // exclusion test that would pass without wiring the selector's filter.
        expect([...sim.particles.staticPrescribed].some(n => material[n] > 0 &&
            Math.hypot(...hit.position.map((v, axis) => v - sim.particles.restPositions[n * 4 + axis])) < sim.grip.radius)).toBe(true);
        for (const nextLaw of ['hard', 'compliant', 'hard']) {
            sim.setDriveLaw(nextLaw);
            expect(held()).toEqual(initial);
            expect((await sim.grab(...ray)).position).toEqual(hit.position);
            expect(held()).toEqual(initial);
        }
        expect(Array.from(sim.particles.invMass)).toEqual(Array.from(material));
        sim.setGrip('singleNode');
        expect((await sim.grab(...ray)).held).toBe(1);
        expect(held()).toEqual(initial.slice(0, 1));
        sim.releaseGrab();
        expect(sim.drive.passes).toEqual([]);
        expect([...sim.particles.staticPrescribed].every(n => sim.particles.gpuInvMass[n] === 0)).toBe(true);
        sim.destroy();
    });

    it('misses all-static material without activating either drive law', async () => {
        const sim = new Simulator(device, [body(() => true)], bounds);
        for (const law of ['hard', 'compliant']) {
            sim.setDriveLaw(law);
            expect(await sim.grab([0, 0, -0.2], [0, 0, 1])).toBeNull();
            expect(sim.drive.passes).toEqual([]);
        }
        sim.destroy();
    });
});

describe('Simulator assembles body-owned static prescription', () => {
    it('supports undeclared, empty and full regions and reports material counts per body', () => {
        const sim = new Simulator(device, [body(), body(() => false), body(() => true)], bounds);
        const counts = sim.stats().perBody;
        expect(counts[0].materialNodes).toBeGreaterThan(0);
        expect(counts[0].staticNodes).toBe(0);
        expect(counts[0].movableNodes).toBe(counts[0].materialNodes);
        expect(counts[1].staticNodes).toBe(0);
        expect(counts[2].staticNodes).toBe(counts[2].materialNodes);
        expect(counts[2].movableNodes).toBe(0);
        const offset = sim.particles.offsetOf(2);
        expect(offset).toBeGreaterThan(0);
        expect(floats(sim.particles.nodeInvMass).slice(offset).every(w => w === 0)).toBe(true);
        expect(sim.particles.invMass.slice(offset).some(w => w > 0)).toBe(true);
        sim.destroy();
    });

    it('retains static support through density changes, release and reset, and resamples a rebuilt body', () => {
        const support = body((x, y) => y <= 0);
        const sim = new Simulator(device, [body(), support], bounds);
        const before = sim.stats().perBody[1];
        expect(before.staticNodes).toBeGreaterThan(0);
        expect(before.movableNodes).toBeGreaterThan(0);
        const offset = sim.particles.offsetOf(1);
        const masses = sim.particles.invMass.slice();
        const fixed = [...sim.particles.staticPrescribed];
        const movable = Array.from(sim.particles.invMass.keys()).find(n => n >= offset && masses[n] > 0 && !sim.particles.staticPrescribed.has(n));
        sim.drive.hold([movable], [[0, 0, 0]]);
        sim.setMaterial(1, { density: support.material.density * 2 });
        sim.releaseGrab();
        expect(sim.particles.gpuInvMass[movable]).toBeCloseTo(masses[movable] / 2, 6);
        expect(fixed.every(n => sim.particles.gpuInvMass[n] === 0)).toBe(true);
        sim.particles.nodePos.write(0, new Float32Array(sim.particles.nodeCount * 4).fill(1));
        sim.particles.nodeVel.write(0, new Float32Array(sim.particles.nodeCount * 4).fill(2));
        sim.reset();
        expect(floats(sim.particles.nodePos)).toEqual(Array.from(sim.particles.restPositions));
        expect(floats(sim.particles.nodeVel).every(v => v === 0)).toBe(true);
        expect([...sim.particles.staticPrescribed]).toEqual(fixed);
        expect(sim.stats().perBody[1]).toMatchObject({
            materialNodes: before.materialNodes, staticNodes: before.staticNodes, movableNodes: before.movableNodes
        });
        sim.destroy();

        // A different preceding body and finer discretisation change both the
        // global offset and local samples; the same world region is re-evaluated.
        support.elementSize = 0.01;
        const rebuilt = new Simulator(device, [body(undefined, 0.03), support], bounds);
        expect(rebuilt.particles.offsetOf(1)).not.toBe(offset);
        expect([...rebuilt.particles.staticPrescribed]).not.toEqual(fixed);
        const start = rebuilt.particles.offsetOf(1);
        for (let n = start; n < rebuilt.particles.nodeCount; n++) {
            expect(rebuilt.particles.staticPrescribed.has(n)).toBe(rebuilt.particles.restPositions[n * 4 + 1] <= 0);
        }
        expect(rebuilt.stats().perBody[1].staticNodes).toBeGreaterThan(0);
        expect(rebuilt.stats().perBody[1].movableNodes).toBeGreaterThan(0);
        rebuilt.destroy();
    });
});


describe('static material remains a contact surface', () => {
    it('keeps the static side still and gives the moving body the full overlap correction', () => {
        // Each body supplies one contact node; the first also has an inactive
        // node so the second surface node needs a nonzero shared offset.
        const particles = new Particles(device, [
            nodes([0, 0, 0, -1, 0, 0], [3, 0], [0]),
            nodes([0.015625, 0, 0], [2])
        ]);
        const proxy = () => ({
            contactSurface: () => ({ nodes: [0], radii: [0.01] }),
            spacing: { min: 0.02, max: 0.02 }
        });
        const contact = new BodyContact(device, particles, [proxy(), proxy()], bounds);
        expect(contact.surfaceCount).toBe(2);
        const uints = new Uint32Array(contact.surface.bytes.buffer);
        const values = new Float32Array(contact.surface.bytes.buffer);
        const records = [0, 1].map(s => ({ node: uints[s * 8], body: uints[s * 8 + 1], radius: values[s * 8 + 2] }));
        expect(records.map(r => [r.node, r.body])).toEqual([[0, 0], [2, 1]]);

        // CPU reference for collide.wgsl + settle.wgsl's single frictionless
        // pair. This exercises uploaded contact records and composed masses;
        // it does not execute WGSL (real GPU position evidence belongs to 08).
        const positions = floats(particles.nodePos);
        const masses = floats(particles.nodeInvMass);
        const corrections = records.map((me, i) => {
            const mate = records[1 - i];
            const delta = positions[me.node * 4] - positions[mate.node * 4];
            const overlap = me.radius + mate.radius - Math.abs(delta);
            if (me.body === mate.body || overlap <= 0 || masses[me.node] + masses[mate.node] === 0) {
                return 0;
            }
            return Math.sign(delta) * overlap * masses[me.node] / (masses[me.node] + masses[mate.node]);
        });
        const next = records.map((r, i) => positions[r.node * 4] + corrections[i]);
        expect(next[0]).toBe(0);
        expect(next[1]).toBeCloseTo(0.02, 8);
        expect(next[1]).toBeGreaterThan(positions[8]);
        expect(particles.invMass[0]).toBe(3);
        contact.destroy();
        particles.destroy();
    });
});
