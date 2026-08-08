import { Color, Entity, SHADOW_PCF3_32F, TONEMAP_ACES2, Vec2, Vec3 } from 'playcanvas';
import { CameraControls } from 'playcanvas/scripts/esm/camera-controls.mjs';

/** Which way the camera sits from the middle of the scene: front, right, above. */
const VIEW_DIR = new Vec3(0.62, 0.27, 0.86).normalize();
/** How far back, in scene diagonals. Far enough that the whole box fits at 45 degrees. */
const VIEW_DISTANCE = 1.25;

/**
 * Camera and lighting. There is no environment map yet, so the look comes from
 * one shadow-casting key light plus a cool fill; the scene is small enough that
 * a tight shadow distance keeps the shadow map dense.
 *
 * The bounds arrive as an argument rather than being imported, so that framing
 * follows whichever scene is being shown.
 *
 * @param {import('playcanvas').AppBase} app - The application.
 * @param {{ min: number[], max: number[] }} bounds - What to look at.
 * @returns {{ camera: Entity, controls: CameraControls }} Camera entity and its controls.
 */
export function createStage(app, { min, max }) {
    const focus = new Vec3(
        (min[0] + max[0]) * 0.5,
        (min[1] + max[1]) * 0.5,
        (min[2] + max[2]) * 0.5
    );

    // Every distance below is a multiple of the scene's diagonal, so a scene of
    // a different size is framed rather than missed. The multiples are the
    // fish tank's own numbers divided by its diagonal: it looks as it did, and
    // now so does anything else.
    const span = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);

    app.scene.ambientLight = new Color(0.14, 0.16, 0.20);

    const camera = new Entity('camera');
    camera.addComponent('camera', {
        clearColor: new Color(0.078, 0.09, 0.11),
        nearClip: 0.01,
        farClip: 50,
        fov: 45
    });
    camera.camera.toneMapping = TONEMAP_ACES2;
    camera.setPosition(
        focus.x + VIEW_DIR.x * span * VIEW_DISTANCE,
        focus.y + VIEW_DIR.y * span * VIEW_DISTANCE,
        focus.z + VIEW_DIR.z * span * VIEW_DISTANCE
    );
    camera.lookAt(focus);
    app.root.addChild(camera);

    camera.addComponent('script');
    const controls = camera.script.create(CameraControls, {
        properties: {
            focusPoint: focus,
            enableFly: false,
            pitchRange: new Vec2(-80, 80),
            zoomRange: new Vec2(span * 0.3, span * 7)
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
        shadowDistance: span * 4.6,
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
