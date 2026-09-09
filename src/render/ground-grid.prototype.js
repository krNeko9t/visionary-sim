import { GraphNode, Layer, Mesh, MeshInstance, PRIMITIVE_LINES } from 'playcanvas';

/** Camera-following editor grid; world Y=0 stays fixed during scene correction. */
export function createGroundGrid(app, camera) {
    // Draw before splats, so the reference cannot paint over captured surfaces.
    // A separate layer also keeps the grid out of the instance picker.
    const layer = new Layer({ name: 'Prototype ground grid' });
    app.scene.layers.insert(layer, 0);
    camera.camera.layers = [...camera.camera.layers, layer.id];
    const positions = [], colors = [];
    // Own a native line material so depth writes do not affect other helpers.
    const material = app.scene.immediate.createMaterial(false);
    material.depthWrite = false;
    material.update();
    const mesh = new Mesh(app.graphicsDevice);
    // Vertices are absolute PlayCanvas coordinates. This identity node is never
    // parented to the capture or its correction entity.
    const worldGridNode = new GraphNode('playcanvas-world-grid');
    const instance = new MeshInstance(mesh, material, worldGridNode);
    const grid = { visible: true, spacing: 0.1 };

    function draw() {
        if (!grid.visible) return;
        const eye = camera.getPosition();
        const radius = Math.min(camera.camera.farClip * 0.75, Math.max(Math.abs(eye.y) * 16, 0.2));
        const level = Math.log10(radius / 20);
        const spacing = 10 ** Math.floor(level);
        const fineAlpha = 1 - (level - Math.floor(level));
        grid.spacing = spacing;
        positions.length = 0;
        colors.length = 0;

        function vertex(x, z, rgb, alpha) {
            const distance = Math.hypot(x - eye.x, z - eye.z) / radius;
            const fade = Math.max(0, 1 - distance * distance);
            positions.push(x, 0, z);
            colors.push(...rgb, alpha * fade * fade);
        }
        function line(alongX, fixed, rgb, alpha) {
            const middle = alongX ? eye.x : eye.z;
            // Segment the line so opacity fades continuously toward the horizon.
            for (let i = 0; i < 16; i++) {
                const a = middle - radius + (2 * radius * i) / 16;
                const b = middle - radius + (2 * radius * (i + 1)) / 16;
                if (alongX) { vertex(a, fixed, rgb, alpha); vertex(b, fixed, rgb, alpha); }
                else { vertex(fixed, a, rgb, alpha); vertex(fixed, b, rgb, alpha); }
            }
        }
        for (const alongX of [true, false]) {
            const center = alongX ? eye.z : eye.x;
            const first = Math.ceil((center - radius) / spacing);
            const last = Math.floor((center + radius) / spacing);
            for (let i = first; i <= last; i++) {
                if (i === 0) continue; // World axes are drawn once, with their own colours.
                const major = i % 10 === 0;
                line(alongX, i * spacing, [0.42, 0.49, 0.55], i % 100 === 0 ? 0.48 : major ? 0.22 + 0.26 * fineAlpha : 0.22 * fineAlpha);
            }
        }
        if (Math.abs(eye.z) < radius) line(true, 0, [0.84, 0.30, 0.28], 0.85);
        if (Math.abs(eye.x) < radius) line(false, 0, [0.28, 0.48, 0.88], 0.85);
        mesh.setPositions(positions);
        mesh.setColors(colors);
        mesh.update(PRIMITIVE_LINES, false);
        app.drawMeshInstance(instance, layer);
    }
    app.on('update', draw);
    app.on('destroy', () => { app.off('update', draw); mesh.destroy(); material.destroy(); });
    return grid;
}
