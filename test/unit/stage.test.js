import { expect, it, vi } from 'vitest';
import { createStage } from '../../src/scene/stage.js';

vi.mock('playcanvas', async importOriginal => ({
    ...await importOriginal(),
    Entity: class {
        constructor(name) { this.name = name; }
        addComponent(kind, options) {
            if (kind === 'script') this.script = { create: (_type, { properties }) => properties };
            else this[kind] = options;
        }
        setPosition(...position) { this.position = position; }
        lookAt(focus) { this.focus = focus; }
        setEulerAngles() {}
    }
}));

it('keeps plant inspection near while allowing the full backdrop inside zoom and clipping ranges', () => {
    const app = { scene: {}, root: { addChild() {} } };
    const focusBounds = { min: [-0.2, 0, -0.2], max: [0.2, 0.4, 0.2] };
    const { camera, controls } = createStage(app, { min: [-20, -10, -20], max: [20, 30, 20] }, { focusBounds });
    expect([camera.focus.x, camera.focus.y, camera.focus.z]).toEqual([0, 0.2, 0]);
    expect(Math.hypot(...camera.position)).toBeLessThan(2);
    expect(controls.zoomRange.x).toBeLessThan(0.3);
    expect(controls.zoomRange.y).toBeGreaterThan(400);
    expect(camera.camera.farClip).toBeGreaterThan(controls.zoomRange.y + 70);
    expect(camera.camera.nearClip).toBe(0.01);
});
