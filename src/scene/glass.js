import { BLEND_NORMAL, Color, CULLFACE_NONE, Entity, StandardMaterial, Vec3 } from 'playcanvas';

/**
 * A glass box with an open top, standing on a floor.
 *
 * This is only how the boundary *looks*. The boundary itself is five analytic
 * planes inside the solver, derived from the same numbers -- which is why this
 * takes the bounds rather than owning them: two scenes can stand in the same
 * kind of tank without either of them owning the other's walls.
 *
 * The floor doubles as the visual ground, so there is no glass bottom:
 * transparent glass lying flat under transparent glass walls sorts badly and
 * buys nothing.
 */

const GLASS_THICKNESS = 0.006;

/**
 * @param {import('playcanvas').AppBase} app - The application.
 * @param {{ min: number[], max: number[] }} bounds - Interior of the tank, in metres.
 * @returns {Entity} Root entity holding the ground and the four glass panels.
 */
export function createGlassBox(app, { min, max }) {
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
