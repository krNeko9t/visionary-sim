import { describe, expect, it } from 'vitest';

import { broadphaseGrid, bucketOf } from '../../src/sim/constraints/broadphase.js';

/**
 * What contact between bodies rests on, in the two halves it actually has.
 *
 * The broadphase half is real code, imported and run. The narrow phase lives in
 * `sim/constraints/wgsl/collide.wgsl` and cannot be run here, so this file
 * carries a transcription of it -- the same arrangement as the WGSL copy of
 * `cellCoords`, kept honest the same way, by reading the two side by side.
 *
 * The two halves fail differently and are worth separating:
 *
 * 1. The broadphase can only fail by *missing* a pair. Nothing it returns is
 *    trusted -- the narrow phase measures the real distance whatever bucket a
 *    pair was found in -- so the only property that matters is that no pair
 *    close enough to touch is ever out of reach of the search. That is one
 *    inequality, and it is checked below rather than argued.
 * 2. The narrow phase can fail by moving the wrong amount. Contact here is a
 *    hard constraint with no compliance to hide behind: whatever it computes
 *    happens, immediately and in full.
 */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const length = a => Math.sqrt(dot(a, a));

/**
 * One node's share of one contact, transcribed from `collide.wgsl`.
 *
 * Returns what the node adds to its own gathered correction. The other node of
 * the pair runs the identical function with the two roles swapped; nothing is
 * shared between them but the two positions and the two masses.
 *
 * @param {object} me - This node: `position`, `previous`, `invMass`, `radius`, `friction`.
 * @param {object} mate - The other node, same shape.
 * @returns {number[]|null} The correction, or null when they do not overlap.
 */
function resolvePair(me, mate) {
    const d = sub(me.position, mate.position);
    const dist = length(d);
    const reach = me.radius + mate.radius;
    if (dist >= reach) {
        return null;
    }

    const total = me.invMass + mate.invMass;
    if (total <= 0) {
        return null;
    }
    const share = me.invMass / total;
    const normal = dist > 1e-9 ? scale(d, 1 / dist) : [0, 1, 0];
    const depth = reach - dist;

    const correction = scale(normal, depth * share);

    const sliding = sub(sub(me.position, me.previous), sub(mate.position, mate.previous));
    const tangent = sub(sliding, scale(normal, dot(sliding, normal)));
    const slid = length(tangent);
    if (slid > 1e-9) {
        const mu = Math.min(me.friction, mate.friction);
        const held = share * Math.min(1, (mu * depth) / slid);
        return sub(correction, scale(tangent, held));
    }
    return correction;
}

/**
 * @param {object} [overrides] - Fields to change.
 * @returns {object} A node at the origin, unit mass, 1 cm radius, no friction.
 */
function node(overrides = {}) {
    return {
        position: [0, 0, 0],
        previous: [0, 0, 0],
        invMass: 1,
        radius: 0.01,
        friction: 0,
        ...overrides
    };
}

describe('the broadphase grid', () => {
    const bounds = { min: [-0.30, 0.0, -0.20], max: [0.30, 0.50, 0.20] };
    const cell = 0.0142;
    const grid = broadphaseGrid(bounds, cell);

    it('covers the bounds with a margin bucket on every side', () => {
        expect(grid.origin).toEqual([bounds.min[0] - cell, bounds.min[1] - cell, bounds.min[2] - cell]);
        for (let axis = 0; axis < 3; axis++) {
            const span = grid.origin[axis] + grid.dims[axis] * cell;
            expect(span).toBeGreaterThanOrEqual(bounds.max[axis]);
        }
        expect(grid.bucketCount).toBe(grid.dims[0] * grid.dims[1] * grid.dims[2]);
    });

    it('round-trips a bucket through its centre', () => {
        // The same packing `bucketAt` uses in sim/constraints/wgsl/contacts.wgsl. If the
        // two ever disagree, every node looks in the wrong neighbourhood and
        // contact silently stops happening rather than going visibly wrong.
        for (const [i, j, k] of [[0, 0, 0], [1, 2, 3], [grid.dims[0] - 1, grid.dims[1] - 1, grid.dims[2] - 1]]) {
            const centre = [
                grid.origin[0] + (i + 0.5) * cell,
                grid.origin[1] + (j + 0.5) * cell,
                grid.origin[2] + (k + 0.5) * cell
            ];
            expect(bucketOf(grid, centre)).toBe(i + grid.dims[0] * (j + grid.dims[1] * k));
        }
    });

    it('gives a bucket to points outside it instead of rejecting them', () => {
        // A body dragged out of the tank still has to be indexed somewhere. The
        // clamp cannot invent a contact, because the narrow phase measures the
        // real distance; it can only crowd the rim, where there is nothing.
        expect(bucketOf(grid, [-100, -100, -100])).toBe(0);
        expect(bucketOf(grid, [100, 100, 100])).toBe(grid.bucketCount - 1);
    });

    it('stays finite when there is nothing to bucket', () => {
        // A scene that is all backdrop and no bodies has no contact diameter to
        // size a bucket with. Falling through divides by zero, and the symptom
        // is not "no bodies" but WebGPU refusing a buffer of infinite length.
        const empty = broadphaseGrid(bounds, 0);
        expect(Number.isFinite(empty.bucketCount)).toBe(true);
        expect(empty.bucketCount).toBeGreaterThan(0);
        expect(empty.cell).toBeGreaterThan(0);
    });

    it('never separates two points that could touch by more than one bucket', () => {
        // This is the whole correctness claim of the broadphase, and it is why
        // the bucket is one contact diameter across: a node searches the
        // twenty-six buckets around its own, so any pair inside that distance
        // has to land within one step on every axis. The reach of a pair is
        // `r_i + r_j`, which is at most twice the widest radius, which is what
        // the cell size is set to -- so testing at exactly `cell` covers every
        // pair that can ever be in contact.
        let random = 12345;
        const next = () => {
            random = (random * 1103515245 + 12345) & 0x7fffffff;
            return random / 0x7fffffff;
        };

        for (let trial = 0; trial < 2000; trial++) {
            const point = [
                bounds.min[0] + next() * (bounds.max[0] - bounds.min[0]),
                bounds.min[1] + next() * (bounds.max[1] - bounds.min[1]),
                bounds.min[2] + next() * (bounds.max[2] - bounds.min[2])
            ];
            // A random offset strictly shorter than one cell.
            const direction = [next() * 2 - 1, next() * 2 - 1, next() * 2 - 1];
            const near = point.map((v, axis) =>
                v + (direction[axis] / Math.max(length(direction), 1e-9)) * cell * 0.999 * next());

            const a = bucketOf(grid, point);
            const b = bucketOf(grid, near);
            const coords = index => [
                index % grid.dims[0],
                Math.floor(index / grid.dims[0]) % grid.dims[1],
                Math.floor(index / (grid.dims[0] * grid.dims[1]))
            ];
            const [ax, ay, az] = coords(a);
            const [bx, by, bz] = coords(b);
            expect(Math.abs(ax - bx)).toBeLessThanOrEqual(1);
            expect(Math.abs(ay - by)).toBeLessThanOrEqual(1);
            expect(Math.abs(az - bz)).toBeLessThanOrEqual(1);
        }
    });
});

describe('one contact', () => {
    it('separates two equal nodes by exactly their overlap, half each', () => {
        const overlap = 0.004;
        const a = node({ position: [0, 0, 0] });
        const b = node({ position: [0.02 - overlap, 0, 0] });

        const forA = resolvePair(a, b);
        const forB = resolvePair(b, a);

        expect(forA[0]).toBeCloseTo(-overlap / 2, 12);
        expect(forB[0]).toBeCloseTo(overlap / 2, 12);
        // Equal and opposite: the pair moves apart without moving anywhere.
        expect(forA.map((v, i) => v + forB[i])).toEqual([0, 0, 0]);
    });

    it('makes the lighter node give way', () => {
        // Ten times the mass takes a tenth of the correction, and the two still
        // add up to the whole overlap. Both threads compute the same split from
        // the same two masses, which is how a Jacobi pair agrees without any
        // communication at all.
        const overlap = 0.004;
        const light = node({ position: [0, 0, 0], invMass: 1 });
        const heavy = node({ position: [0.02 - overlap, 0, 0], invMass: 0.1 });

        expect(resolvePair(light, heavy)[0]).toBeCloseTo(-overlap * (1 / 1.1), 12);
        expect(resolvePair(heavy, light)[0]).toBeCloseTo(overlap * (0.1 / 1.1), 12);
    });

    it('leaves an inert node exactly where it is', () => {
        const free = node({ position: [0, 0, 0] });
        const pinned = node({ position: [0.016, 0, 0], invMass: 0 });

        expect(resolvePair(pinned, free)).toEqual([0, 0, 0]);
        expect(resolvePair(free, pinned)[0]).toBeCloseTo(-0.004, 12);
    });

    it('does nothing to a pair that is merely close', () => {
        expect(resolvePair(node(), node({ position: [0.02, 0, 0] }))).toBeNull();
        expect(resolvePair(node(), node({ position: [0.05, 0, 0] }))).toBeNull();
    });

    it('separates coincident nodes instead of dividing by zero', () => {
        // Two nodes at the same point have no direction to push along, so one
        // is invented. It has to be antisymmetric, or the pair drifts together
        // rather than apart; here the transcription always answers +y, and the
        // kernel picks the sign from the node indices for that reason.
        const correction = resolvePair(node(), node());
        expect(Number.isFinite(correction[0] + correction[1] + correction[2])).toBe(true);
        expect(correction[1]).toBeCloseTo(0.01, 12);
    });

    it('cancels a small slide outright and caps a large one', () => {
        const overlap = 0.004;
        const contact = (slide, friction) => {
            const a = node({
                position: [0, 0, 0],
                previous: [0, -slide, 0],
                friction
            });
            const b = node({ position: [0.02 - overlap, 0, 0], friction });
            return resolvePair(a, b);
        };

        // Sticking: the slide is well inside `mu * depth`, so all of it goes.
        // Half, because the other node is asked for the other half.
        const stuck = contact(0.0002, 0.5);
        expect(stuck[1]).toBeCloseTo(-0.0002 / 2, 12);

        // Sliding: past the limit only `mu * depth` of it goes, whatever the
        // slide was. This is the Coulomb cone, and without the cap a fast
        // tangential motion would be stopped dead by a graze.
        const sliding = contact(0.01, 0.5);
        expect(sliding[1]).toBeCloseTo(-(0.5 * overlap) / 2, 12);

        // Frictionless contact is purely normal however far it slid.
        const free = contact(0.01, 0);
        expect(free[1]).toBeCloseTo(0, 12);
        expect(free[0]).toBeCloseTo(-overlap / 2, 12);
    });

    it('takes the lower of the two friction coefficients', () => {
        // Ice on rubber is ice. Taking the higher would let a sticky body grip
        // through a slippery one.
        const slide = 0.01;
        const overlap = 0.004;
        const a = node({ position: [0, 0, 0], previous: [0, -slide, 0], friction: 0.9 });
        const b = node({ position: [0.02 - overlap, 0, 0], friction: 0.1 });

        expect(resolvePair(a, b)[1]).toBeCloseTo(-(0.1 * overlap) / 2, 12);
    });
});
