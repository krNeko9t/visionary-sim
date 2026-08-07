import { describe, expect, it } from 'vitest';

import { box, sphere } from '../../src/assets/shapes.js';
import { restNormals } from '../../src/render/normals.js';

describe('restNormals', () => {
    it('gives a sphere radial unit normals', () => {
        const radius = 0.05;
        const { positions, indices } = sphere({ radius }).surface;
        const normals = restNormals(positions, indices);

        for (let v = 0; v < positions.length; v += 3) {
            const length = Math.hypot(normals[v], normals[v + 1], normals[v + 2]);
            expect(length).toBeCloseTo(1, 5);

            const radial = [0, 1, 2].reduce((sum, axis) =>
                sum + (positions[v + axis] / radius) * normals[v + axis], 0);
            // A polygonal sphere's vertex normal is the average of its faces,
            // which tilts it off the radius by half a facet.
            expect(radial).toBeGreaterThan(0.99);
        }
    });

    it('keeps a box flat, one normal per face', () => {
        // Six axis-aligned directions and nothing between them: proof that the
        // separate patches really are separate, which is the only mechanism
        // there is for putting a crease in a surface.
        const { positions, indices } = box({ halfExtents: [0.045, 0.045, 0.045] }).surface;
        const normals = restNormals(positions, indices);
        const directions = new Set();

        for (let v = 0; v < normals.length; v += 3) {
            const axes = [normals[v], normals[v + 1], normals[v + 2]];
            expect(Math.hypot(...axes)).toBeCloseTo(1, 5);
            directions.add(axes.map(value => Math.round(value)).join(','));
            expect(axes.filter(value => Math.abs(value) > 1e-6)).toHaveLength(1);
        }
        expect(directions.size).toBe(6);
    });

    it('leaves a vertex no triangle uses alone rather than undefined', () => {
        const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 9, 9, 9]);
        const normals = restNormals(positions, new Uint32Array([0, 1, 2]));

        expect([...normals.slice(0, 3)]).toEqual([0, 0, 1]);
        expect([...normals.slice(9, 12)]).toEqual([0, 0, 0]);
    });
});
