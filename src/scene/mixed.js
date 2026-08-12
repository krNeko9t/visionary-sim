import { createGlassBox } from './glass.js';
import { meshBody, splatBody } from '../body/factory.js';
import { BREAD, CRUMB } from './splats.js';
import { JELLY } from './tank.js';

/**
 * One body from each render path, sharing a tank.
 *
 * This is the scene that argues §三's claim rather than merely stating it: the
 * two representations are not a route from one to the other, they are two
 * things that coexist. `spot` never learns the Gaussians exist, `bread` never
 * learns the triangles do, and contact between them happens on the nodes both
 * discretisations produce -- the same path `splats-contact` uses between two
 * captures, exercised here between a mesh and a cloud instead.
 *
 * Materials and the bread declaration are imported rather than restated, for
 * the reason `scene/splats.js` gives for `BREAD` itself: a fact about an asset
 * or a material belongs to one file, not to every scene that uses it.
 */

/** The same open-topped box every scene in this file uses. */
const BOUNDS = {
    min: [-0.30, 0.0, -0.20],
    max: [0.30, 0.50, 0.20]
};

/** @type {import('./scenes.js').Scene} */
export const mixedScene = {
    name: 'mixed',
    bounds: BOUNDS,
    decorate: app => createGlassBox(app, BOUNDS),
    createBodies: () => Promise.all([
        meshBody('/models/spot.obj', {
            name: 'spot',
            size: 0.17,
            position: [0.0, 0.0, 0.0],
            resolution: 12,
            material: JELLY,
            tint: [0.95, 0.42, 0.30]
        }),
        // Falls from above onto spot's back, so contact between the two render
        // paths is exercised rather than merely possible. Position is the one
        // field overridden: everything else about the asset stays BREAD's own.
        splatBody(BREAD.url, {
            name: BREAD.name,
            convention: BREAD.convention,
            size: BREAD.size,
            position: [0.0, 0.30, 0.0],
            resolution: 12,
            material: CRUMB
        })
    ])
};
