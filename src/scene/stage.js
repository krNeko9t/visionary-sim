import { Color, Entity, SHADOW_PCF3_32F, TONEMAP_ACES2, Vec2, Vec3 } from 'playcanvas';
import { CameraControls } from 'playcanvas/scripts/esm/camera-controls.mjs';

import { TANK_BOUNDS } from './tank.js';

/**
 * Camera and lighting. There is no environment map yet, so the look comes from
 * one shadow-casting key light plus a cool fill; the tank is small enough that
 * a tight shadow distance keeps the shadow map dense.
 *
 * @param {import('playcanvas').AppBase} app - The application.
 * @returns {{ camera: Entity, controls: CameraControls }} Camera entity and its controls.
 */
export function createStage(app) {
    const { min, max } = TANK_BOUNDS;
    const focus = new Vec3(
        (min[0] + max[0]) * 0.5,
        (min[1] + max[1]) * 0.5,
        (min[2] + max[2]) * 0.5
    );

    app.scene.ambientLight = new Color(0.14, 0.16, 0.20);

    const camera = new Entity('camera');
    camera.addComponent('camera', {
        clearColor: new Color(0.078, 0.09, 0.11),
        nearClip: 0.01,
        farClip: 50,
        fov: 45
    });
    camera.camera.toneMapping = TONEMAP_ACES2;
    camera.setPosition(0.62, 0.52, 0.86);
    camera.lookAt(focus);
    app.root.addChild(camera);

    camera.addComponent('script');
    const controls = camera.script.create(CameraControls, {
        properties: {
            focusPoint: focus,
            enableFly: false,
            pitchRange: new Vec2(-80, 80),
            zoomRange: new Vec2(0.25, 6)
        }
    });

    const key = new Entity('light-key');
    key.addComponent('light', {
        type: 'directional',
        color: new Color(1.0, 0.97, 0.92),
        intensity: 2.4,
        castShadows: true,
        shadowType: SHADOW_PCF3_32F,
        shadowResolution: 2048,
        shadowDistance: 4,
        shadowBias: 0.05,
        normalOffsetBias: 0.03,
        shadowIntensity: 0.75
    });
    key.setEulerAngles(52, 28, 0);
    app.root.addChild(key);

    const fill = new Entity('light-fill');
    fill.addComponent('light', {
        type: 'directional',
        color: new Color(0.45, 0.58, 0.78),
        intensity: 0.8,
        castShadows: false
    });
    fill.setEulerAngles(-18, -140, 0);
    app.root.addChild(fill);

    return { camera, controls };
}
