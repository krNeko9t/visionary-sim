import { describe, expect, it } from 'vitest';

import { CONVENTIONS, orientCloud, placeCloud } from '../../src/assets/splats/place.js';
import { REQUIRED_PROPERTIES, cloudFromPly } from '../../src/assets/splats/cloud.js';
import { cleanCloud, subsetCloud } from '../../src/assets/splats/clean.js';
import { measureCloud, rawBounds, robustBounds } from '../../src/assets/splats/measure.js';
import { readPly } from '../../src/assets/splats/ply.js';

/**
 * The 3DGS entry path, checked on synthetic data.
 *
 * Synthetic rather than on `bread.ply` and `wolf.ply` on purpose: those are 61 MB
 * of someone's capture, they are not in the repository, and a unit test that
 * cannot run on a fresh clone is not a guarantee. What they are for is the
 * things a file cannot tell you -- which way is up, how big it is -- and those
 * are settled by looking, not by asserting.
 */

const SH_C0 = 0.28209479177387814;

/**
 * Builds a binary little-endian PLY in memory.
 *
 * @param {{ name: string, type: string, values: number[] }[]} properties - Columns.
 * @param {object} [options] - Overrides for the malformed-file cases.
 * @param {string} [options.format] - Replacement format line.
 * @param {string[]} [options.extraHeader] - Lines inserted before `end_header`.
 * @param {number} [options.truncate] - Bytes to cut from the end of the body.
 * @returns {ArrayBuffer} The file.
 */
function buildPly(properties, { format, extraHeader = [], truncate = 0 } = {}) {
    const count = properties[0].values.length;
    const sizes = { uchar: 1, ushort: 2, float: 4, double: 8 };
    const header = [
        'ply',
        format ?? 'format binary_little_endian 1.0',
        `element vertex ${count}`,
        ...properties.map(({ type, name }) => `property ${type} ${name}`),
        ...extraHeader,
        'end_header',
        ''
    ].join('\n');

    const stride = properties.reduce((total, { type }) => total + sizes[type], 0);
    const headerBytes = new TextEncoder().encode(header);
    const buffer = new ArrayBuffer(headerBytes.length + stride * count - truncate);
    new Uint8Array(buffer).set(headerBytes.subarray(0, Math.min(headerBytes.length, buffer.byteLength)));

    const view = new DataView(buffer, headerBytes.length);
    for (let i = 0; i < count; i++) {
        let at = i * stride;
        for (const { type, values } of properties) {
            if (at + sizes[type] > view.byteLength) {
                return buffer;
            }
            if (type === 'float') view.setFloat32(at, values[i], true);
            else if (type === 'double') view.setFloat64(at, values[i], true);
            else if (type === 'ushort') view.setUint16(at, values[i], true);
            else view.setUint8(at, values[i]);
            at += sizes[type];
        }
    }
    return buffer;
}

/**
 * @param {number[]} positions - Centres, 3 per splat.
 * @param {object} [fields] - Anything else to override.
 * @returns {import('../../src/assets/splats/cloud.js').SplatCloud} A cloud.
 */
function cloudOf(positions, fields = {}) {
    const count = positions.length / 3;
    return {
        count,
        positions: Float32Array.from(positions),
        rotations: fields.rotations ?? Float32Array.from(
            Array.from({ length: count }, () => [0, 0, 0, 1]).flat()
        ),
        scales: fields.scales ?? new Float32Array(count * 3).fill(0.01),
        opacity: fields.opacity ?? new Float32Array(count).fill(1),
        colors: fields.colors ?? new Float32Array(count * 3).fill(0.5)
    };
}

describe('the PLY container', () => {
    const properties = [
        { name: 'x', type: 'float', values: [1, 2, 3] },
        { name: 'flag', type: 'uchar', values: [7, 8, 9] },
        { name: 'y', type: 'double', values: [-1.5, 0, 1.5] },
        { name: 'code', type: 'ushort', values: [1000, 2000, 3000] }
    ];

    it('reads every scalar type into floats', () => {
        const { count, properties: read } = readPly(buildPly(properties));
        expect(count).toBe(3);
        expect([...read.x]).toEqual([1, 2, 3]);
        expect([...read.flag]).toEqual([7, 8, 9]);
        expect([...read.y]).toEqual([-1.5, 0, 1.5]);
        expect([...read.code]).toEqual([1000, 2000, 3000]);
    });

    it('strides correctly past properties it was not asked for', () => {
        // The interesting failure: skipping a column by not allocating it, and
        // then reading the remaining ones at the wrong offsets.
        const { properties: read } = readPly(buildPly(properties), { properties: ['y'] });
        expect(Object.keys(read)).toEqual(['y']);
        expect([...read.y]).toEqual([-1.5, 0, 1.5]);
    });

    it('rejects what it cannot honestly read', () => {
        expect(() => readPly(buildPly(properties, { format: 'format ascii 1.0' })))
            .toThrow(/binary_little_endian/);
        expect(() => readPly(buildPly(properties, { extraHeader: ['property list uchar int vertex_index'] })))
            .toThrow(/list property/);
        expect(() => readPly(buildPly(properties, { truncate: 4 }))).toThrow(/truncated/);
        expect(() => readPly(buildPly(properties), { properties: ['nope'] })).toThrow(/no property nope/);
        expect(() => readPly(new TextEncoder().encode('not a ply at all').buffer)).toThrow(/not a PLY/);
    });
});

describe('a cloud read out of a PLY', () => {
    const ply = {
        count: 2,
        properties: Object.fromEntries(REQUIRED_PROPERTIES.map(name => [name, new Float32Array(2)]))
    };
    ply.properties.x.set([1, -1]);
    ply.properties.scale_0.set([Math.log(0.5), 0]);
    ply.properties.opacity.set([0, 100]);
    ply.properties.f_dc_0.set([1 / SH_C0, 0]);
    // Unnormalised, negative real part: exactly what a trainer writes.
    ply.properties.rot_0.set([-2, 0]);
    ply.properties.rot_1.set([0, 0]);

    const cloud = cloudFromPly(ply);

    it('undoes the file encoding', () => {
        expect(cloud.scales[0]).toBeCloseTo(0.5, 6);
        expect(cloud.scales[3]).toBeCloseTo(1, 6);
        expect(cloud.opacity[0]).toBeCloseTo(0.5, 6);
        expect(cloud.opacity[1]).toBeCloseTo(1, 6);
        expect(cloud.colors[0]).toBeCloseTo(1.5, 6);
        expect(cloud.colors[3]).toBeCloseTo(0.5, 6);
    });

    it('canonicalises the quaternions', () => {
        // Normalised, real part non-negative, and `rot_0` landing in w.
        expect(cloud.rotations[3]).toBeCloseTo(1, 6);
        expect(Math.hypot(...cloud.rotations.slice(0, 4))).toBeCloseTo(1, 6);
        // An all-zero quaternion is not a rotation; it becomes the identity
        // rather than a NaN that would poison every bounding box downstream.
        expect([...cloud.rotations.slice(4, 8)]).toEqual([0, 0, 0, 1]);
    });
});

describe('placing a cloud in the world', () => {
    it('has only rotations for conventions', () => {
        for (const [name, q] of Object.entries(CONVENTIONS)) {
            expect(Math.hypot(...q), name).toBeCloseTo(1, 12);
        }
    });

    it('carries each source frame to y-up', () => {
        // One unit vector per axis, so a permutation or a sign flip shows.
        const zUp = orientCloud(cloudOf([1, 0, 0, 0, 1, 0, 0, 0, 1]), 'z-up');
        expect([...zUp.positions].map(v => Math.round(v) + 0)).toEqual([1, 0, 0, 0, 0, -1, 0, 1, 0]);

        const yDown = orientCloud(cloudOf([1, 0, 0, 0, 1, 0, 0, 0, 1]), 'y-down');
        expect([...yDown.positions].map(v => Math.round(v) + 0)).toEqual([1, 0, 0, 0, -1, 0, 0, 0, -1]);
    });

    it('turns each Gaussian with the frame it is in', () => {
        // A splat sitting at the identity must come out holding the convention
        // itself; if positions turned and rotations did not, the body would be
        // right way up and made of sideways ellipsoids.
        const { rotations } = orientCloud(cloudOf([0, 0, 0]), 'z-up');
        expect([...rotations]).toEqual(CONVENTIONS['z-up'].map(v => Math.fround(v)));
    });

    it('rejects a convention it does not know', () => {
        expect(() => orientCloud(cloudOf([0, 0, 0]), 'colmap')).toThrow(/unknown splat convention/);
    });

    it('sizes and stands the cloud the way a mesh body is sized and stood', () => {
        const cloud = cloudOf([0, 0, 0, 2, 1, 0.5]);
        const { scale } = placeCloud(cloud, { convention: 'y-up', size: 0.4, position: [10, 5, -3] });

        expect(scale).toBeCloseTo(0.2, 6);
        // Longest axis at the requested size, base on the given height, centred
        // in x and z -- the same rule `normalizeMesh` applies.
        expect(cloud.positions[0]).toBeCloseTo(10 - 0.2, 6);
        expect(cloud.positions[3]).toBeCloseTo(10 + 0.2, 6);
        expect(cloud.positions[1]).toBeCloseTo(5, 6);
        expect(cloud.positions[4]).toBeCloseTo(5.2, 6);
        expect(cloud.positions[2]).toBeCloseTo(-3 - 0.05, 6);
    });

    it('scales the Gaussians along with the distances between them', () => {
        // Scaling positions but not scales is not a subtle bug: the body comes
        // out the right size and made of boulders.
        const cloud = cloudOf([0, 0, 0, 2, 0, 0], { scales: new Float32Array([1, 1, 1, 1, 1, 1]) });
        placeCloud(cloud, { convention: 'y-up', size: 0.4, position: [0, 0, 0] });
        expect(cloud.scales[0]).toBeCloseTo(0.2, 6);
    });
});

describe('cleaning a cloud', () => {
    const cloud = cloudOf(
        [0, 0, 0, 1, 1, 1, 2, 2, 2],
        { opacity: new Float32Array([0.9, 0.01, 0.5]) }
    );

    it('drops the Gaussians nobody can see', () => {
        const cleaned = cleanCloud(cloud, { minOpacity: 0.1 });
        expect(cleaned.count).toBe(2);
        expect([...cleaned.positions]).toEqual([0, 0, 0, 2, 2, 2]);
        expect([...cleaned.opacity]).toEqual([0.9, 0.5].map(Math.fround));
    });

    it('keeps every array in step', () => {
        // The one thing a subset can get wrong, and the reason it is one
        // function rather than a loop in each filter.
        const picked = subsetCloud(cloud, [2, 0]);
        expect([...picked.positions]).toEqual([2, 2, 2, 0, 0, 0]);
        expect([...picked.rotations]).toEqual([0, 0, 0, 1, 0, 0, 0, 1]);
        expect([...picked.opacity]).toEqual([0.5, 0.9].map(Math.fround));
        expect(picked.colors.length).toBe(6);
        expect(picked.scales.length).toBe(6);
    });
});

describe('measuring a cloud', () => {
    // Two hundred splats along a unit segment plus one a hundred metres away:
    // the shape of a real capture, where the untrimmed box says nothing about
    // the object.
    const positions = Array.from({ length: 200 }, (unused, i) => [i / 199, 0, 0]).flat();
    const cloud = cloudOf([...positions, 100, 0, 0]);

    it('reports the raw box as it is', () => {
        expect(rawBounds(cloud).max[0]).toBe(100);
    });

    it('trims the tails before believing an extent', () => {
        expect(robustBounds(cloud).max[0]).toBeLessThan(1.01);
        expect(measureCloud(cloud).extent[0]).toBeLessThan(1.01);
    });

    it('says how much of the box is floaters', () => {
        // The number that tells you the opacity filter has work to do.
        expect(measureCloud(cloud).floaterRatio[0]).toBeGreaterThan(50);
    });
});
