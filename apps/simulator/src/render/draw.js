import { createLineView } from './lines.js';
import { createMeshView } from './mesh.js';
import { createSplatView } from './splats.js';

/**
 * The one door into `render/` for anything carried by a field.
 *
 * Geometry is told apart by what it is made of, and by nothing else: a body's
 * surface and the proxy's own wireframe arrive the same way, and nothing here
 * can tell which is which. A new kind of primitive means a line in
 * {@link PAINTERS}; a new place geometry comes from means nothing here at all.
 *
 * @typedef {{ kind: 'triangles', mesh: import('./mesh.js').RestSurface }
 *         | { kind: 'gaussians', cloud: import('./splats.js').RestCloud }
 *         | ({ kind: 'lines' } & import('./lines.js').RestLines)}
 *   CarriedGeometry
 */

/**
 * How each kind of primitive becomes an entity. A table rather than a chain of
 * conditionals because the number of entries is what grows.
 *
 * @type {Record<string, (app: import('playcanvas').AppBase, geometry: any,
 *   field: import('visionary-sim/deformation/bind.js').DeformationField,
 *   options: { name: string, tint?: number[] }) => import('playcanvas').Entity>}
 */
const PAINTERS = {
    triangles: (app, geometry, field, { tint }) => createMeshView(app, geometry.mesh, field, { tint }),
    gaussians: (app, geometry, field, { name }) => createSplatView(app, name, geometry.cloud, field),
    lines: (app, geometry, field, { name }) => createLineView(app, geometry, field, { name })
};

/**
 * @param {import('playcanvas').AppBase} app - The application.
 * @param {CarriedGeometry} geometry - Rest-space geometry, tagged by its primitive kind.
 * @param {import('visionary-sim/deformation/bind.js').DeformationField} field - Deformation to follow.
 * @param {object} options - Appearance.
 * @param {string} options.name - What to call the entity.
 * @param {number[]} [options.tint] - Linear RGB base colour, where the geometry
 *   does not bring its own.
 * @returns {import('playcanvas').Entity} An entity drawing it.
 */
export function draw(app, geometry, field, options) {
    const paint = PAINTERS[geometry?.kind];
    if (!paint) {
        throw new Error(`no way to draw geometry of kind "${geometry?.kind}"`);
    }
    return paint(app, geometry, field, options);
}
