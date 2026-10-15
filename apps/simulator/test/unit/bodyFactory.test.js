import { afterEach, expect, it, vi } from 'vitest';
import { meshBody, shapeBody, splatBody } from '../../src/body/factory.js';
import { box } from '../../src/assets/shapes.js';
import { loadCapture } from '../../src/assets/splats/capture.js';

vi.mock('../../src/assets/splats/capture.js', () => ({ loadCapture: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

it('places a mesh in world metres while keeping its appearance in the application', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () =>
        'v 0 0 0\nv 2 0 0\nv 0 2 0\nf 1 2 3\n' })));
    const { body, render, tint } = await meshBody('/triangle.obj', {
        name: 'mesh', size: 0.2, position: [1, 2, 3], tint: [0.1, 0.2, 0.3], elementSize: 0.02
    });
    expect(Array.from(body.source.mesh.positions)).toEqual([
        Math.fround(0.9), 2, 3, Math.fround(1.1), 2, 3, Math.fround(0.9), Math.fround(2.2), 3
    ]);
    expect(render).toEqual({ kind: 'triangles', mesh: body.source.mesh });
    expect(tint).toEqual([0.1, 0.2, 0.3]);
    expect(body).not.toHaveProperty('render');
    expect(body).not.toHaveProperty('tint');
});

it('keeps generated drawing triangles outside the analytic physical shape and preserves the default colour', () => {
    const { body, render, tint } = shapeBody(box({ halfExtents: [0.1, 0.2, 0.3] }), {
        name: 'box', position: [1, 2, 3]
    });
    expect(body.source.shape).not.toHaveProperty('surface');
    expect(body.source.shape.bounds).toEqual({ min: [0.9, 2, 2.7], max: [1.1, 2.4, 3.3] });
    expect(body.source.shape.sdf(1, 2.2, 3)).toBeCloseTo(-0.1);
    expect(render.mesh.positions.length).toBeGreaterThan(0);
    expect(tint).toEqual([0.92, 0.45, 0.26]);
});

it('shares prepared Gaussian values without sending colours or the asset report into physics', async () => {
    const cloud = { count: 1, positions: new Float32Array([0, 1, 0]),
        rotations: new Float32Array([0, 0, 0, 1]), scales: new Float32Array([0.01, 0.02, 0.03]),
        opacity: new Float32Array([1]), colors: new Float32Array([0.2, 0.4, 0.6]) };
    loadCapture.mockResolvedValueOnce({ cloud, report: 'measured capture' });
    const object = await splatBody('/capture.ply', { name: 'capture', convention: 'y-up', size: 1, position: [0, 0, 0] });
    expect(object.render).toEqual({ kind: 'gaussians', cloud });
    expect(object.report).toBe('measured capture');
    expect(object.body.source).not.toHaveProperty('report');
    expect(object.body.source.cloud).not.toHaveProperty('colors');
    for (const key of ['positions', 'rotations', 'scales', 'opacity']) {
        expect(object.body.source.cloud[key]).toBe(cloud[key]);
    }
});
