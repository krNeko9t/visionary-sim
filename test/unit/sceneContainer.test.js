import { describe, expect, it } from 'vitest';

import { createSceneReference, resolveSceneTransform } from '../../src/app/sceneTransform.js';
import {
    containerGeometry,
    createSceneContainer,
    editSceneContainer,
    followSceneCalibration,
    inspectSceneContainment
} from '../../src/render/sceneContainer.js';

const close = (actual, expected, digits = 10) => {
    expect(actual).toHaveLength(expected.length);
    actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], digits));
};

describe('the editable scene container', () => {
    const positions = Float32Array.from([-1, -0.5, -0.25, 1, 0.5, 0.25, 0, 0, 0]);
    const reference = createSceneReference(positions);

    it('starts as a positive six-sided box around the complete scene', () => {
        const transform = resolveSceneTransform(reference, { longestMeters: 1 });
        const container = createSceneContainer(reference, transform);
        close(container.world.position, [0, 0, 0]);
        close(container.world.dimensions, [1, 0.5, 0.25]);
        expect(inspectSceneContainment(container.world, transform.transformPoints(positions))).toEqual({
            contained: true,
            outsideCount: 0,
            totalCount: 3,
            warning: null
        });
        const geometry = containerGeometry(container.world);
        expect(geometry.corners).toHaveLength(8);
        expect(geometry.edges).toHaveLength(12);
        expect(geometry.faces).toHaveLength(6);
        for (const face of geometry.faces) {
            expect(face.inwardNormal).toHaveLength(3);
            const [a, b, c] = face.corners.map(index => geometry.corners[index]);
            const ab = b.map((value, axis) => value - a[axis]);
            const ac = c.map((value, axis) => value - a[axis]);
            const normal = [
                ab[1] * ac[2] - ab[2] * ac[1],
                ab[2] * ac[0] - ab[0] * ac[2],
                ab[0] * ac[1] - ab[1] * ac[0]
            ];
            expect(normal.reduce((sum, value, axis) => sum + value * face.inwardNormal[axis], 0))
                .toBeGreaterThan(0);
        }
    });

    it('follows absolute scene calibration without changing the fixed reference', () => {
        const before = resolveSceneTransform(reference, { longestMeters: 1 });
        const initial = createSceneContainer(reference, before);
        const edited = editSceneContainer(initial, before, {
            position: [0.25, 0, 0],
            dimensions: [0.8, 0.7, 0.6]
        });
        const after = resolveSceneTransform(reference, {
            upAxis: '+Z',
            manualDegrees: [0, 45, 0],
            longestMeters: 2,
            position: [3, 4, 5]
        });
        const followed = followSceneCalibration(edited, after);

        close(followed.world.position, after.toWorldPoint(edited.relative.position));
        close(followed.world.dimensions, [1.6, 1.4, 1.2]);
        expect(after.reference).toBe(reference);
        expect(followed.relative).toEqual(edited.relative);
    });

    it('edits the container independently and reports scene points left outside', () => {
        const transform = resolveSceneTransform(reference, { longestMeters: 1 });
        const initial = createSceneContainer(reference, transform);
        const sceneBefore = transform.transformPoints(positions);
        const edited = editSceneContainer(initial, transform, {
            position: [1, 0, 0],
            dimensions: [0.2, 0.2, 0.2]
        });
        const sceneAfter = transform.transformPoints(positions);

        expect(sceneAfter).toEqual(sceneBefore);
        expect(inspectSceneContainment(edited.world, sceneAfter)).toMatchObject({
            contained: false,
            outsideCount: 3,
            warning: '3 of 3 scene centres are outside the container'
        });
    });

    it('rejects invalid independent edits instead of creating shear or negative size', () => {
        const transform = resolveSceneTransform(reference, { longestMeters: 1 });
        const initial = createSceneContainer(reference, transform);
        expect(() => editSceneContainer(initial, transform, { dimensions: [1, 0, 1] }))
            .toThrow('positive finite');
        expect(() => editSceneContainer(initial, transform, { orientation: [0, 0, 0, 0] }))
            .toThrow('non-zero finite quaternion');
    });
});
