import { describe, expect, it } from 'vitest';

import { DEFAULT_GRIPPED_PART_RADIUS, GRIPS, singleNode, withinRadius, worstCaseHeldNodes } from '../../src/sim/grip.js';

/**
 * The property that is this milestone: how much material the hand commands
 * must not depend on the lattice's resolution.
 *
 * The wrong thing to measure is the held set's spatial extent -- `singleNode`
 * always holds a single point, extent zero at every `h`, which is also
 * "resolution independent" and would let a broken fix pass. What actually
 * varies with `h` is the *material* one hold commands: one node commands one
 * cell, `volume = h^3`, so halving `h` commands an eighth of the material --
 * that factor of 8 is the reported complaint ("越密越重"). `withinRadius`
 * commands a fixed ball regardless of `h`, up to the ball's own O(h/R)
 * discretisation error.
 */

/**
 * A cube of lattice nodes at spacing `h`, filling the same world box
 * regardless of `h`, with a node exactly at the centre.
 *
 * @param {number} h - Node spacing, metres.
 * @param {number} [extent] - Box edge length, metres. Must divide evenly by
 *   `h` into an even number of cells so a node lands exactly on the centre.
 * @returns {{ positions: Float32Array, invMass: Float32Array, nodeOffsets: number[], centre: number }}
 */
function lattice(h, extent = 0.12) {
    const n = Math.round(extent / h);
    const perAxis = n + 1;
    const count = perAxis ** 3;
    const positions = new Float32Array(count * 4);
    const invMass = new Float32Array(count).fill(1);

    let index = 0;
    for (let i = 0; i < perAxis; i++) {
        for (let j = 0; j < perAxis; j++) {
            for (let k = 0; k < perAxis; k++) {
                positions[index * 4] = (i - n / 2) * h;
                positions[index * 4 + 1] = (j - n / 2) * h;
                positions[index * 4 + 2] = (k - n / 2) * h;
                index++;
            }
        }
    }

    const half = n / 2;
    const centre = (half * perAxis + half) * perAxis + half;
    return { positions, invMass, nodeOffsets: [0], centre };
}

/**
 * @param {import('../../src/sim/grip.js').GrippedPart} grip - A held set.
 * @param {number} h - The lattice's node spacing.
 * @returns {number} Material commanded, in cubic metres, at one cell per node.
 */
const heldVolume = (grip, h) => grip.nodes.length * h ** 3;

describe('withinRadius commands material independent of lattice resolution', () => {
    const RADIUS = 0.04;

    it('holds the same material at h and at h/2, while singleNode holds an eighth', () => {
        const coarse = lattice(0.01);
        const fine = lattice(0.005);
        const opts = { radius: RADIUS, nodeOffsets: coarse.nodeOffsets, limit: Infinity };

        const ballCoarse = withinRadius(coarse.positions, coarse.invMass, coarse.centre, opts);
        const ballFine = withinRadius(fine.positions, fine.invMass, fine.centre,
            { ...opts, nodeOffsets: fine.nodeOffsets });

        const ballRatio = heldVolume(ballFine, 0.005) / heldVolume(ballCoarse, 0.01);
        // The ball's own discretisation error is O(h/R) and shrinks as the
        // lattice refines; ±10% leaves ~4x headroom over the measured ~2.6%.
        expect(ballRatio).toBeGreaterThan(0.9);
        expect(ballRatio).toBeLessThan(1.1);

        const nodeCoarse = singleNode(coarse.positions, coarse.invMass, coarse.centre);
        const nodeFine = singleNode(fine.positions, fine.invMass, fine.centre);
        const nodeRatio = heldVolume(nodeFine, 0.005) / heldVolume(nodeCoarse, 0.01);
        // The complaint itself, reproduced exactly: halve the cell, command
        // an eighth of the material.
        expect(nodeRatio).toBeCloseTo(1 / 8, 9);
    });

    it('keeps the hand a size in metres, not just a volume, at both resolutions', () => {
        const coarse = lattice(0.01);
        const fine = lattice(0.005);
        const opts = { radius: RADIUS, limit: Infinity };

        const ballCoarse = withinRadius(coarse.positions, coarse.invMass, coarse.centre,
            { ...opts, nodeOffsets: coarse.nodeOffsets });
        const ballFine = withinRadius(fine.positions, fine.invMass, fine.centre,
            { ...opts, nodeOffsets: fine.nodeOffsets });

        for (const [grip, h] of [[ballCoarse, 0.01], [ballFine, 0.005]]) {
            const maxOffset = Math.max(...grip.offsets.map(o => Math.hypot(...o)));
            expect(maxOffset).toBeGreaterThan(RADIUS - h);
            expect(maxOffset).toBeLessThanOrEqual(RADIUS);
        }
    });
});

describe('singleNode', () => {
    it('holds exactly the anchor, with a zero offset', () => {
        const grip = singleNode(new Float32Array(4), new Float32Array(1).fill(1), 0);
        expect(grip.nodes).toEqual([0]);
        expect(grip.offsets).toEqual([[0, 0, 0]]);
        expect(grip.found).toBe(1);
    });

    it('ignores the radius option', () => {
        const grip = singleNode(new Float32Array(4), new Float32Array(1).fill(1), 0, { radius: 999 });
        expect(grip.nodes).toEqual([0]);
    });
});

describe('withinRadius contract', () => {
    it('filters static material before counting and truncating without growing the ball or crossing bodies', () => {
        const positions = Float32Array.from([
            0, 0, 0, 0, 0.01, 0, 0, 0, 0.02, 0, 0, 0,
            -0.02, 0, 0, 0, 0.025, 0, 0, 0, 0.04, 0, 0, 0, 0, 0, 0, 0
        ]);
        const masses = new Float32Array(7).fill(1);
        const options = { radius: 0.03, nodeOffsets: [0, 6], limit: 2, staticPrescribed: new Set([1]) };
        const grip = withinRadius(positions, masses, 0, options);
        expect(grip.nodes).toEqual([0, 2]);
        expect(grip.found).toBe(4);
        expect(withinRadius(positions, masses, 0, { ...options, limit: 9 }).nodes).toEqual([0, 2, 3, 4]);
    });

    it('both strategies reject static or empty anchors', () => {
        const positions = new Float32Array(8);
        const masses = Float32Array.from([1, 0]);
        const options = { radius: 1, nodeOffsets: [0], staticPrescribed: new Set([0]) };
        for (const strategy of Object.values(GRIPS)) {
            for (const anchor of [0, 1]) {
                expect(strategy(positions, masses, anchor, options)).toEqual({ nodes: [], offsets: [], found: 0 });
            }
        }
    });

    it('always holds the anchor first, with an exact zero offset', () => {
        const { positions, invMass, nodeOffsets, centre } = lattice(0.01);
        const grip = withinRadius(positions, invMass, centre, { radius: 0.03, nodeOffsets });
        expect(grip.nodes[0]).toBe(centre);
        expect(grip.offsets[0]).toEqual([0, 0, 0]);
    });

    it('orders the rest nearest-first, breaking exact ties by node index', () => {
        const { positions, invMass, nodeOffsets, centre } = lattice(0.01);
        const grip = withinRadius(positions, invMass, centre, { radius: 0.015, nodeOffsets });
        const distances = grip.offsets.map(o => Math.hypot(...o));
        for (let i = 1; i < distances.length; i++) {
            expect(distances[i]).toBeGreaterThanOrEqual(distances[i - 1] - 1e-12);
        }
        // The six face neighbours sit at exactly equal distance; among those,
        // node index must be ascending.
        const faceNeighbours = grip.nodes.slice(1, 7);
        expect(faceNeighbours).toEqual([...faceNeighbours].sort((a, b) => a - b));
    });

    it('excludes nodes with no material, the same rule pick.js applies', () => {
        const { positions, invMass, nodeOffsets, centre } = lattice(0.01);
        invMass[centre + 1] = 0; // an immediate neighbour along the packed axis
        const grip = withinRadius(positions, invMass, centre, { radius: 0.03, nodeOffsets });
        expect(grip.nodes).not.toContain(centre + 1);
    });

    it('never reaches past its own body, even when a neighbour body sits within radius', () => {
        const a = lattice(0.01);
        const bNodeStart = a.positions.length / 4;
        // A second body's single node placed one cell past body A's edge --
        // well within a generous radius of the perimeter, but not of centre.
        const edge = new Float32Array(4);
        edge[0] = 0.07;
        const positions = new Float32Array([...a.positions, ...edge]);
        const invMass = new Float32Array([...a.invMass, 1]);
        const nodeOffsets = [0, bNodeStart];

        const grip = withinRadius(positions, invMass, a.centre, { radius: 1, nodeOffsets });
        expect(grip.nodes).not.toContain(bNodeStart);
    });

    it('truncates to the nearest `limit` nodes and reports the true count in `found`', () => {
        const { positions, invMass, nodeOffsets, centre } = lattice(0.01);
        const full = withinRadius(positions, invMass, centre, { radius: 0.03, nodeOffsets });
        const limited = withinRadius(positions, invMass, centre, { radius: 0.03, nodeOffsets, limit: 5 });

        expect(limited.nodes).toEqual(full.nodes.slice(0, 5));
        expect(limited.found).toBe(full.nodes.length);
        expect(limited.nodes.length).toBe(5);
    });

    it('at radius 0 answers exactly what singleNode answers', () => {
        const { positions, invMass, nodeOffsets, centre } = lattice(0.01);
        const ball = withinRadius(positions, invMass, centre, { radius: 0, nodeOffsets });
        const single = singleNode(positions, invMass, centre);
        expect(ball).toEqual(single);
    });
});

describe('GRIPS', () => {
    it('names both strategies for table dispatch', () => {
        expect(GRIPS.singleNode).toBe(singleNode);
        expect(GRIPS.withinRadius).toBe(withinRadius);
    });
});

describe('DEFAULT_GRIPPED_PART_RADIUS', () => {
    it('clears the coarsest cell in the repo (the wolf, 0.02 m) so the ball holds more than the anchor', () => {
        expect(DEFAULT_GRIPPED_PART_RADIUS).toBeGreaterThan(0.02);
    });

    it('stays well under the smallest body in the repo (~0.15 m)', () => {
        expect(DEFAULT_GRIPPED_PART_RADIUS * 2).toBeLessThan(0.15);
    });
});

describe('worstCaseHeldNodes', () => {
    it('bounds the true count from above across a spread of r/h', () => {
        for (const [radius, h] of [[0.03, 0.02], [0.03, 0.01], [0.03, 0.005], [0.04, 0.0025]]) {
            const { positions, invMass, nodeOffsets, centre } = lattice(h, 0.16);
            const actual = withinRadius(positions, invMass, centre, { radius, nodeOffsets }).nodes.length;
            expect(worstCaseHeldNodes(radius, h)).toBeGreaterThanOrEqual(actual);
        }
    });
});
