import { describe, expect, it } from 'vitest';

import {
    UP_AXIS_PRESETS,
    compareSceneTransforms,
    createSceneReference,
    resolveSceneTransform,
    transformCloudGeometry
} from '../../src/app/sceneTransform.js';

const close = (actual, expected, digits = 10) => {
    expect(actual).toHaveLength(expected.length);
    actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], digits));
};

describe('scene calibration', () => {
    it('uses every finite scene centre as one fixed metric reference', () => {
        const reference = createSceneReference(Float32Array.from([
            -1, -0.5, -0.25,
            1, 0.5, 0.25,
            0.2, -0.1, 0.1
        ]));
        expect(reference).toEqual({
            min: [-1, -0.5, -0.25],
            max: [1, 0.5, 0.25],
            center: [0, 0, 0],
            extent: [2, 1, 0.5],
            longest: 2,
            count: 3
        });

        const transform = resolveSceneTransform(reference, { longestMeters: 1 });
        close(transform.worldBounds.extent, [1, 0.5, 0.25]);
        expect(transform.scale).toBe(0.5);
    });

    it.each([
        ['+Y', [0, 1, 0]],
        ['-Y', [0, -1, 0]],
        ['+Z', [0, 0, 1]],
        ['-Z', [0, 0, -1]],
        ['+X', [1, 0, 0]],
        ['-X', [-1, 0, 0]]
    ])('%s maps the declared source up axis to world +Y', (upAxis, sourceUp) => {
        expect(UP_AXIS_PRESETS).toHaveProperty(upAxis);
        const reference = createSceneReference([-1, -1, -1, 1, 1, 1]);
        const transform = resolveSceneTransform(reference, { upAxis });
        close(transform.toWorldDirection(sourceUp), [0, 1, 0]);
        expect(transform.determinant).toBeCloseTo(1, 12);
    });

    it('applies absolute fixed-world X, Y, Z angles after the preset', () => {
        const reference = createSceneReference([-1, -1, -1, 1, 1, 1]);
        const transform = resolveSceneTransform(reference, {
            upAxis: '+Z',
            manualDegrees: [0, 0, 90],
            longestMeters: 3,
            position: [4, 5, 6]
        });
        close(transform.toWorldPoint(reference.center), [4, 5, 6]);
        close(transform.toWorldDirection([0, 0, 1]), [-1, 0, 0]);
        close([
            transform.matrix[0] * 0.25 + transform.matrix[4] * -0.5 + transform.matrix[8] * 0.75 + transform.matrix[12],
            transform.matrix[1] * 0.25 + transform.matrix[5] * -0.5 + transform.matrix[9] * 0.75 + transform.matrix[13],
            transform.matrix[2] * 0.25 + transform.matrix[6] * -0.5 + transform.matrix[10] * 0.75 + transform.matrix[14]
        ], transform.toWorldPoint([0.25, -0.5, 0.75]));

        const restored = resolveSceneTransform(reference, transform.config);
        close(restored.rotation, transform.rotation);
        close(restored.toWorldPoint([0.25, -0.5, 0.75]), transform.toWorldPoint([0.25, -0.5, 0.75]));
    });

    it('transforms centres, Gaussian axes, and directions without mutating source data', () => {
        const source = {
            count: 1,
            positions: Float32Array.from([2, 0, 0]),
            rotations: Float32Array.from([0, 0, 0, 1]),
            scales: Float32Array.from([0.2, 0.1, 0.05])
        };
        const reference = createSceneReference([0, 0, 0, 2, 1, 0.5]);
        const transform = resolveSceneTransform(reference, {
            upAxis: '+Y',
            manualDegrees: [0, 0, 90],
            longestMeters: 1,
            position: [3, 4, 5]
        });
        const world = transformCloudGeometry(source, transform);

        close([...world.positions], [3.25, 4.5, 4.875], 6);
        close([...world.scales], [0.1, 0.05, 0.025], 6);
        close([...world.rotations], [0, 0, Math.SQRT1_2, Math.SQRT1_2], 6);
        close([...source.positions], [2, 0, 0]);
        close(transform.toSourceDirection(transform.toWorldDirection([0.2, 0.3, 0.4])), [0.2, 0.3, 0.4]);
    });

    it.each([
        [[], 'at least one'],
        [[0, 0, 0, Number.NaN, 1, 1], 'finite'],
        [[2, 2, 2, 2, 2, 2], 'non-zero']
    ])('rejects an unusable source reference', (positions, message) => {
        expect(() => createSceneReference(positions)).toThrow(message);
    });

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
        'rejects non-positive or non-finite metre length %s',
        (longestMeters) => {
            const reference = createSceneReference([0, 0, 0, 2, 1, 1]);
            expect(() => resolveSceneTransform(reference, { longestMeters })).toThrow('positive finite');
        }
    );

    it('keeps a finite reference centre when same-sign bounds nearly overflow', () => {
        const low = 1e308;
        const high = 1.0000000000000002e308;
        const reference = createSceneReference([low, 0, 0, high, 1, 1]);
        expect(reference.center[0]).toBe(low + (high - low) * 0.5);
        expect(Number.isFinite(reference.center[0])).toBe(true);
    });

    it('rejects an underflowed or overflowed derived scale', () => {
        const huge = createSceneReference([0, 0, 0, 1e308, 1, 1]);
        expect(() => resolveSceneTransform(huge, { longestMeters: Number.MIN_VALUE }))
            .toThrow('calibration scale');

        const tiny = createSceneReference([0, 0, 0, Number.MIN_VALUE, 0, 0]);
        expect(() => resolveSceneTransform(tiny, { longestMeters: Number.MAX_VALUE }))
            .toThrow('calibration scale');
    });

    it('rejects a finite scale whose scene-graph translation overflows', () => {
        const low = 1e308;
        const high = 1.0000000000000002e308;
        const reference = createSceneReference([low, 0, 0, high, 1, 1]);
        expect(() => resolveSceneTransform(reference, { longestMeters: 1e308 }))
            .toThrow('finite affine transform');
    });

    it('separates metric invalidation from rigid display changes', () => {
        const reference = createSceneReference([0, 0, 0, 2, 1, 1]);
        const base = resolveSceneTransform(reference);
        const moved = resolveSceneTransform(reference, { position: [1, 0, 0] });
        const resized = resolveSceneTransform(reference, { longestMeters: 2 });
        expect(compareSceneTransforms(base, moved)).toEqual({ geometryChanged: true, lengthDerivedInvalid: false });
        expect(compareSceneTransforms(base, resized)).toEqual({ geometryChanged: true, lengthDerivedInvalid: true });
        expect(compareSceneTransforms(base, resolveSceneTransform(reference))).toEqual({
            geometryChanged: false,
            lengthDerivedInvalid: false
        });
    });
});
