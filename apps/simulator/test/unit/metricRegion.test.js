import { describe, expect, it } from 'vitest';

import { createMetricRegion, extendMaterialRegion, splitCloudByRegion } from '../../src/scene/metricRegion.js';
import { cleanCloud } from '../../src/assets/splats/clean.js';
import { staticNodesInRegion } from 'visionary-sim/sim/staticPrescription.js';

describe('measured material labels extended to an inferred volume', () => {
    it('keeps thin movable material free beyond the sample radius while retaining support', () => {
        const measured = createMetricRegion([0, 0.25, 0], 0.016);
        const region = extendMaterialRegion([0, 0, 0, 0, 0.25, 0], measured);
        expect(measured.movable(0.02, 0.25, 0)).toBe(false);
        expect(region.movable(0.02, 0.25, 0)).toBe(true);
        expect(region.staticRegion(0.02, 0, 0)).toBe(true);
        for (const p of [[0, 0, 0], [0, 0.25, 0]]) {
            expect(region.movable(...p)).toBe(measured.movable(...p));
        }
    });
    it('agrees with nearest measured material, with deterministic source-order ties', () => {
        const points = [[-1, 0, 0], [1, 0, 0], [0, 2, 1], [-2, 2, -1]];
        const measured = { movable: x => x > 0 };
        const region = extendMaterialRegion(points.flat(), measured);
        for (let i = -10; i <= 10; i++) for (let j = -10; j <= 10; j++) {
            const q = [i / 4, j / 4, 0.1];
            const nearest = points.map((p, id) => ({ p, id, d: Math.hypot(...p.map((v, a) => v - q[a])) }))
                .sort((a, b) => a.d - b.d || a.id - b.id)[0].p;
            expect(region.movable(...q)).toBe(measured.movable(...nearest));
        }
        expect(region.movable(0, 0, 0)).toBe(false);
    });
    it('owns samples and labels and handles missing or invalid material', () => {
        const positions = [0, 1, 0];
        const region = extendMaterialRegion(positions, { movable: () => true });
        positions.fill(99);
        expect(region.movable(0, 1, 0)).toBe(true);
        expect(extendMaterialRegion([], { movable: () => true }).movable(0, 0, 0)).toBe(false);
        expect(() => extendMaterialRegion([0, NaN, 0], { movable: () => true })).toThrow(/material samples/);
        expect(() => region.movable(NaN, 0, 0)).toThrow(/query/);
    });
});

describe('a movable region in rest-world metres', () => {
    it('includes the Euclidean boundary and exposes its static complement', () => {
        const region = createMetricRegion([0, 0, 0, -2, 1, -3], 5);
        for (const [position, movable] of [
            [[0, 0, 0], true], [[3, 4, 0], true],
            [[3, 4, 0.001], false], [[4, 4, 0], false],
            [[-5, -3, -3], true], [[20, 0, 0], false]
        ]) {
            expect(region.movable(...position)).toBe(movable);
            expect(region.staticRegion(...position)).toBe(!movable);
        }
    });

    it('rejects invalid inputs even when there are no samples', () => {
        for (const samples of [null, {}, '123', [1], [1, 2], [0, NaN, 0], [Infinity, 0, 0], [0, '0', 0]]) {
            expect(() => createMetricRegion(samples, 1)).toThrow(/samples/);
        }
        for (const r of [-1, NaN, Infinity, -Infinity, '1', undefined]) {
            expect(() => createMetricRegion([], r)).toThrow(/tolerance/);
        }
        const region = createMetricRegion([], 1);
        for (const position of [[NaN, 0, 0], [0, Infinity, 0], [0, 0, -Infinity], ['0', 0, 0], [0, 0]]) {
            expect(() => region.movable(...position)).toThrow(/query/);
            expect(() => region.staticRegion(...position)).toThrow(/query/);
        }
    });

    it('makes an empty region all static and zero tolerance exact membership', () => {
        const empty = createMetricRegion([], 0);
        expect(empty.staticRegion(0, 0, 0)).toBe(true);
        const region = createMetricRegion([0, 0, 0, -1, 2, -3, -1, 2, -3], 0);
        expect(region.movable(-1, 2, -3)).toBe(true);
        expect(region.movable(-0, 0, 0)).toBe(true);
        expect(region.movable(Number.MIN_VALUE, 0, 0)).toBe(false);
        expect(region.movable(-1, 2, -3 + Number.EPSILON * 2)).toBe(false);
    });

    it('matches a brute force reference across spatial edges, duplicates and permutations', () => {
        let seed = 173;
        const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
        const samples = Array.from({ length: 100 }, () => Array.from({ length: 3 }, () => random() * 8 - 4));
        samples.push([-1, 0, 0], [0, 0, 0], [0, 0, 0], [1, 1, 1]);
        const queries = Array.from({ length: 200 }, () => Array.from({ length: 3 }, () => random() * 10 - 5));
        queries.push(...samples, [-2, 0, 0], [-2 - Number.EPSILON * 2, 0, 0], [1, 0, 0], [1, 1, 2]);
        for (const r of [0, 0.125, 1, 3]) {
            const expected = queries.map(q => samples.some(p => Math.hypot(...q.map((v, a) => v - p[a])) <= r));
            for (const order of [samples, [...samples].reverse(), [...samples.slice(40), ...samples.slice(0, 40)]]) {
                for (let repeat = 0; repeat < 2; repeat++) {
                    const region = createMetricRegion(order.flat(), r);
                    expect(queries.map(q => region.movable(...q))).toEqual(expected);
                }
            }
        }
    });

    it('keeps finite extreme distances meaningful without squared-distance overflow or underflow', () => {
        expect(createMetricRegion([0, 0, 0], 1e-200).movable(2e-200, 0, 0)).toBe(false);
        expect(createMetricRegion([0, 0, 0], 1e200).movable(2e200, 0, 0)).toBe(false);
        expect(createMetricRegion([-Number.MAX_VALUE, 0, 0], Number.MAX_VALUE)
            .movable(Number.MAX_VALUE, 0, 0)).toBe(false);
    });

    it('owns the declaration independently of subsequent sample mutations', () => {
        const samples = new Float64Array([0, 0, 0]);
        const region = createMetricRegion(samples, 0);
        samples[0] = 10;
        expect(region.movable(0, 0, 0)).toBe(true);
        expect(region.movable(10, 0, 0)).toBe(false);
    });

    it('samples the same world region at coarse and fine node spacings', () => {
        const region = createMetricRegion([0, 0, 0], 0.25);
        const coarse = [-0.5, 0, 0, -0.25, 0, 0, 0, 0, 0, 0.25, 0, 0, 0.5, 0, 0];
        const fine = Array.from({ length: 9 }, (_, i) => [-0.5 + i * 0.125, 0, 0]).flat();
        expect(staticNodesInRegion(coarse, region.staticRegion)).toEqual([0, 4]);
        expect(staticNodesInRegion(fine, region.staticRegion)).toEqual([0, 1, 7, 8]);
        expect(coarse.filter((_, i) => i % 3 === 0).map(x => region.movable(x, 0, 0)))
            .toEqual([false, true, true, true, false]);
    });
});

function foreground() {
    return {
        count: 4,
        positions: Float32Array.from([0, 0, 0, 0.25, 0, 0, 0.5, 0, 0, 10, 0, 0]),
        scales: Float32Array.from([10, 20, 30, 40, 50, 60, 70, 80, 90, 1, 1, 1]),
        rotations: Float32Array.from([0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]),
        colors: Float32Array.from([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1, 1]),
        opacity: Float32Array.from([0.2, 0.4, 0.6, 0.01])
    };
}

describe('partitioning the already-cleaned complete foreground', () => {
    it('shares the node predicate and preserves every attribute with no gaps or duplication', () => {
        const source = cleanCloud(foreground());
        const before = structuredClone(source);
        const region = createMetricRegion([0, 0, 0], 0.25);
        const { movable, fixed } = splitCloudByRegion(source, region);
        expect([source.count, movable.count, fixed.count]).toEqual([3, 2, 1]);
        expect(staticNodesInRegion(source.positions, region.staticRegion)).toEqual([2]);
        for (const [property, stride] of [['positions', 3], ['rotations', 4], ['scales', 3], ['colors', 3], ['opacity', 1]]) {
            expect(movable[property]).toEqual(source[property].slice(0, 2 * stride));
            expect(fixed[property]).toEqual(source[property].slice(2 * stride));
        }
        expect(source).toEqual(before);
        expect(splitCloudByRegion(source, region)).toEqual({ movable, fixed });
    });

    it('returns valid empty subsets for empty, all movable and all fixed inputs', () => {
        const source = cleanCloud(foreground());
        for (const [samples, r, counts] of [[[], 0, [0, 3]], [[0, 0, 0], 1, [3, 0]]]) {
            const { movable, fixed } = splitCloudByRegion(source, createMetricRegion(samples, r));
            expect([movable.count, fixed.count]).toEqual(counts);
            expect(movable.count ? movable : fixed).toEqual(source);
            const empty = movable.count ? fixed : movable;
            for (const property of ['positions', 'rotations', 'scales', 'colors', 'opacity']) {
                expect(empty[property]).toEqual(new Float32Array());
            }
        }
        const emptySource = cleanCloud(foreground(), { minOpacity: 1 });
        expect(splitCloudByRegion(emptySource, createMetricRegion([], 0)))
            .toEqual({ movable: emptySource, fixed: emptySource });
    });

    it('keeps interleaved attributes aligned and reports invalid Gaussian centres', () => {
        const source = cleanCloud(foreground());
        const region = createMetricRegion([0.25, 0, 0], 0);
        const { movable, fixed } = splitCloudByRegion(source, region);
        expect([movable.count, fixed.count]).toEqual([1, 2]);
        for (const [property, stride] of [['positions', 3], ['rotations', 4], ['scales', 3], ['colors', 3], ['opacity', 1]]) {
            expect(movable[property]).toEqual(source[property].slice(stride, 2 * stride));
            expect([...fixed[property]]).toEqual([
                ...source[property].slice(0, stride), ...source[property].slice(2 * stride)
            ]);
        }
        source.positions[0] = NaN;
        expect(() => splitCloudByRegion(source, region)).toThrow(/query/);
    });
});
