import { GraphNode, Layer, Mesh, MeshInstance, PRIMITIVE_LINES } from 'playcanvas';

/** Draw a camera-sized visual reference in absolute world coordinates at Y=0. */
export function createGroundGrid(app, camera) {
    const layer = new Layer({ name: 'World reference grid' });
    app.scene.layers.insert(layer, 0);
    camera.camera.layers = [...camera.camera.layers, layer.id];
    const material = app.scene.immediate.createMaterial(false);
    material.depthWrite = false;
    material.update();
    const mesh = new Mesh(app.graphicsDevice);
    const instance = new MeshInstance(mesh, material, new GraphNode('world-y-zero-grid'));
    const grid = { visible: true, spacing: 0.1 };
    const positions = [];
    const colors = [];

    const draw = () => {
        if (!grid.visible) return;
        const eye = camera.getPosition();
        const radius = Math.min(camera.camera.farClip * 0.75, Math.max(Math.abs(eye.y) * 16, 2));
        const level = Math.log10(radius / 20);
        const spacing = 10 ** Math.floor(level);
        grid.spacing = spacing;
        positions.length = 0;
        colors.length = 0;
        const vertex = (x, z, rgb, alpha) => {
            const fade = Math.max(0, 1 - (Math.hypot(x - eye.x, z - eye.z) / radius) ** 2);
            positions.push(x, 0, z);
            colors.push(...rgb, alpha * fade * fade);
        };
        const line = (alongX, fixed, rgb, alpha) => {
            const middle = alongX ? eye.x : eye.z;
            for (let segment = 0; segment < 16; segment++) {
                const a = middle - radius + 2 * radius * segment / 16;
                const b = middle - radius + 2 * radius * (segment + 1) / 16;
                if (alongX) { vertex(a, fixed, rgb, alpha); vertex(b, fixed, rgb, alpha); }
                else { vertex(fixed, a, rgb, alpha); vertex(fixed, b, rgb, alpha); }
            }
        };
        for (const alongX of [true, false]) {
            const center = alongX ? eye.z : eye.x;
            for (let i = Math.ceil((center - radius) / spacing); i <= Math.floor((center + radius) / spacing); i++) {
                if (i !== 0) line(alongX, i * spacing, [0.42, 0.49, 0.55], i % 10 === 0 ? 0.4 : 0.16);
            }
        }
        if (Math.abs(eye.z) < radius) line(true, 0, [0.84, 0.30, 0.28], 0.85);
        if (Math.abs(eye.x) < radius) line(false, 0, [0.28, 0.48, 0.88], 0.85);
        mesh.setPositions(positions);
        mesh.setColors(colors);
        mesh.update(PRIMITIVE_LINES, false);
        app.drawMeshInstance(instance, layer);
    };
    app.on('update', draw);
    return {
        ...grid,
        dispose() {
            app.off('update', draw);
            app.scene.layers.remove(layer);
            mesh.destroy();
            material.destroy();
        }
    };
}
