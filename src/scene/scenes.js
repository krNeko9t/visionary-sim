import { bunnyScene, tankScene } from './tank.js';
import { footballScene } from './football.js';
import { mixedScene } from './mixed.js';
import { splatContactScene, splatScene } from './splats.js';

/**
 * Which scenes there are, and how to ask for one.
 *
 * A scene is where the walls are, what stands inside them, and what is drawn
 * around them. Those three used to be a single hard-wired path -- one AABB
 * imported by name in three places -- and that was fine for exactly as long as
 * there was one scene. It stops being fine the moment a second one needs
 * different walls, so the bounds became data a scene owns and nobody imports
 * across.
 *
 * The boundary is still an AABB in the solver rather than an object in the
 * world. Making it a body that is rendered and collided with like any other is
 * a real design, and a later one; this only stops the tank from being the only
 * thing that can exist.
 *
 * @typedef {object} Scene
 * @property {string} name - How it is asked for.
 * @property {{ min: number[], max: number[] }} bounds - The solver's walls, and
 *   what the camera frames. Plain numbers: the simulation must not depend on
 *   PlayCanvas, and the camera must not depend on the simulation.
 * @property {(app: import('playcanvas').AppBase) => void} decorate - Everything
 *   drawn that is not a body.
 * @property {() => Promise<import('../body/softBody.js').SoftBody[]>} createBodies -
 *   What is simulated.
 * @property {(() => Promise<import('../assets/splats/capture.js').Capture[]>)} [scenery] -
 *   Captures that are drawn but not stepped. A scene-scale scan arrives split
 *   across several files, and only some of them are ever going to be objects;
 *   the rest are there so the scene is whole.
 */

/** @type {Record<string, Scene>} */
export const SCENES = {
    tank: tankScene,
    bunny: bunnyScene,
    football: footballScene,
    splats: splatScene,
    'splats-contact': splatContactScene,
    mixed: mixedScene
};

/** Shown when nothing else is asked for. */
export const DEFAULT_SCENE = 'tank';

/**
 * @param {string} [name] - A key of {@link SCENES}.
 * @returns {Scene} The scene.
 */
export function sceneNamed(name) {
    const scene = SCENES[name ?? DEFAULT_SCENE];
    if (!scene) {
        throw new Error(`no scene named "${name}"; known: ${Object.keys(SCENES).join(', ')}`);
    }
    return scene;
}
