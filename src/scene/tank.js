import { BLEND_NORMAL, Color, CULLFACE_NONE, Entity, StandardMaterial, Vec3 } from 'playcanvas';

/**
 * Interior of the fish tank, in metres. This is plain data on purpose: the
 * simulation consumes it as six analytic planes and must not depend on
 * PlayCanvas. The top is open -- there is no `y = max` wall.
 *
 * The floor (`min[1]`) doubles as the visual ground plane, so the tank has no
 * glass bottom: transparent glass lying flat under transparent glass walls
 * sorts badly and buys nothing.
 */
export const TANK_BOUNDS = {
    min: [-0.30, 0.0, -0.20],
    max: [0.30, 0.50, 0.20]
};

const GLASS_THICKNESS = 0.006;

/**
 * Builds the glass walls and the ground the tank stands on.
 *
 * @param {import('playcanvas').AppBase} app - The application.
 * @returns {Entity} Root entity holding the ground and the four glass panels.
 */
export function createTank(app) {
    const { min, max } = TANK_BOUNDS;
    const root = new Entity('tank');

    const glass = new StandardMaterial();
    glass.diffuse = new Color(0.55, 0.72, 0.78);
    glass.specular = new Color(1, 1, 1);
    glass.gloss = 0.95;
    glass.useMetalness = true;
    glass.metalness = 0.0;
    glass.opacity = 0.13;
    glass.blendType = BLEND_NORMAL;
    glass.depthWrite = false;
    glass.cull = CULLFACE_NONE;
    glass.update();

    const ground = new StandardMaterial();
    ground.diffuse = new Color(0.17, 0.18, 0.20);
    ground.gloss = 0.35;
    ground.useMetalness = true;
    ground.metalness = 0.0;
    ground.update();

    const floor = new Entity('ground');
    floor.addComponent('render', { type: 'plane', material: ground, castShadows: false });
    floor.setLocalScale(6, 1, 6);
    floor.setLocalPosition(0, min[1], 0);
    root.addChild(floor);

    const height = max[1] - min[1];
    const width = max[0] - min[0];
    const depth = max[2] - min[2];
    const midY = min[1] + height * 0.5;

    // Panels sit just outside the interior so the simulation bounds and the
    // visible inner glass surface coincide.
    const half = GLASS_THICKNESS * 0.5;
    const panels = [
        { name: 'wall-x-min', pos: [min[0] - half, midY, 0], scale: [GLASS_THICKNESS, height, depth] },
        { name: 'wall-x-max', pos: [max[0] + half, midY, 0], scale: [GLASS_THICKNESS, height, depth] },
        { name: 'wall-z-min', pos: [0, midY, min[2] - half], scale: [width, height, GLASS_THICKNESS] },
        { name: 'wall-z-max', pos: [0, midY, max[2] + half], scale: [width, height, GLASS_THICKNESS] }
    ];

    for (const panel of panels) {
        const entity = new Entity(panel.name);
        entity.addComponent('render', { type: 'box', material: glass, castShadows: false });
        entity.setLocalPosition(...panel.pos);
        entity.setLocalScale(...panel.scale);
        root.addChild(entity);
    }

    app.root.addChild(root);

    // A wire outline gives the glass definition that 13% opacity cannot.
    const wireMin = new Vec3(min[0], min[1], min[2]);
    const wireMax = new Vec3(max[0], max[1], max[2]);
    const wireColor = new Color(0.45, 0.68, 0.78, 1);
    app.on('update', () => app.drawWireAlignedBox(wireMin, wireMax, wireColor));

    return root;
}
