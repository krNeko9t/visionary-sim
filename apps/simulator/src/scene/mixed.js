import { createGlassBox } from './glass.js';
import { meshBody, splatBody } from '../body/factory.js';
import { BREAD, CRUMB } from './splats.js';
import { JELLY } from './tank.js';

/**
 * A mesh and a Gaussian capture sharing a tank.
 *
 * Contact happens on the proxy geometry, and has nothing to do with what is
 * drawn: `spot` never learns the Gaussians exist, `bread` never learns the
 * triangles do, and the collision between them is the same one `splats-contact`
 * runs between two captures.
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
    createObjects: () => Promise.all([
        meshBody('/models/spot.obj', {
            name: 'spot',
            size: 0.17,
            position: [0.0, 0.0, 0.0],
            elementSize: 0.0142,
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
            elementSize: 0.0158,
            material: CRUMB
        })
    ])
};
