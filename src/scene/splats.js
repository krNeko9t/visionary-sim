import { createGlassBox } from './glass.js';
import { loadCapture } from '../assets/splats/capture.js';

/**
 * Two scans standing in a tank, for getting 3DGS through the door.
 *
 * The declarations below are the point of this scene. A 3DGS PLY states neither
 * its up axis nor its units, so both are written down here by hand and checked
 * against the report each capture prints. These two disagree with each other --
 * `bread` came out y-up, `wolf` z-up -- which is the whole argument against
 * picking one convention and calling it the standard.
 *
 * Nothing here is simulated yet. The clouds are scenery: drawn, not stepped.
 * That distinction is not scaffolding either -- a scene-scale capture split
 * across several files will have parts that are only ever backdrop.
 */

/** Room enough for both, and the same open-topped box the fish tank uses. */
const BOUNDS = {
    min: [-0.30, 0.0, -0.20],
    max: [0.30, 0.50, 0.20]
};

/** @type {import('./scenes.js').Scene} */
export const splatScene = {
    name: 'splats',
    bounds: BOUNDS,
    decorate: app => createGlassBox(app, BOUNDS),
    createBodies: () => Promise.resolve([]),
    scenery: () => Promise.all([
        loadCapture('/splats/bread.ply', {
            name: 'bread',
            convention: 'y-up',
            size: 0.18,
            position: [-0.13, 0.0, 0.0]
        }),
        loadCapture('/splats/wolf.ply', {
            name: 'wolf',
            convention: 'z-up',
            size: 0.24,
            position: [0.13, 0.0, 0.0]
        })
    ])
};
