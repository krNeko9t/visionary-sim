import { expect, it } from 'vitest';
import { SoftBody } from '../../src/body/softBody.js';

it('accepts in-memory world geometry without retaining application drawing options', () => {
    const source = { kind: 'mesh', mesh: {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2])
    } };
    const body = new SoftBody({ name: 'triangle', source, render: { kind: 'triangles' }, tint: [1, 0, 0] });
    expect(body.source).toBe(source);
    expect(body.name).toBe('triangle');
    expect(body.material.density).toBeGreaterThan(0);
    expect(body).not.toHaveProperty('render');
    expect(body).not.toHaveProperty('tint');
});
