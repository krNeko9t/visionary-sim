import { Simulator } from '../../src/sim/simulator.js';

/**
 * The one place this test touches the simulator.
 *
 * Everything the reference does goes through here: build the simulator for a
 * scene, take steps, grab, read node positions. When the simulator's public
 * surface changes -- fields become methods, it takes a `GPUDevice` and submits
 * its own work -- this file changes and nothing else in the test does.
 *
 * Today it drives the simulator the way `src/main.js` does: on the PlayCanvas
 * application's device, with dispatches recorded inside a render frame. Node
 * positions are read from `particles`, which is not yet public; that read is
 * the reason this file exists.
 */

/**
 * @param {import('playcanvas').AppBase} app - A started application.
 * @param {import('../../src/scene/scenes.js').Scene} scene - A prepared scene.
 * @param {import('../../src/body/softBody.js').SoftBody[]} bodies - Its bodies.
 * @returns {object} The simulation, as this test uses it.
 */
export function openSimulation(app, scene, bodies) {
    const sim = new Simulator(app.graphicsDevice, bodies, scene.bounds);
    scene.validateSimulation?.(sim.stats());
    if (scene.gravity !== undefined) sim.params.gravity = [...scene.gravity];
    if (scene.grab) {
        sim.setDriveLaw(scene.grab.law);
        sim.setDriveResponseTime(scene.grab.responseTime);
    }

    /** Takes `steps` steps in one frame. */
    const frame = steps => new Promise(resolve => app.once('update', () => {
        sim.dispatch(steps);
        app.once('postrender', resolve);
    }));

    return {
        /** Seconds per fixed physical step. */
        dt: sim.stats().stepDuration,

        /**
         * @param {number} steps - Fixed physical steps to take.
         * @param {number} batch - At most this many per frame.
         * @param {(done: number) => void} [beforeBatch] - Called before each
         *   batch with how many steps will have been taken after it.
         */
        async advance(steps, batch, beforeBatch) {
            for (let done = 0; done < steps;) {
                const n = Math.min(batch, steps - done);
                done += n;
                beforeBatch?.(done);
                await frame(n);
            }
        },

        /** @returns {Promise<Float32Array>} Every node's position, xyz per node, in metres. */
        async readNodes() {
            const raw = await sim.particles.readPositions();
            const positions = new Float32Array(raw.length / 4 * 3);
            for (let n = 0; n < positions.length / 3; n++) {
                positions.set(raw.subarray(n * 4, n * 4 + 3), n * 3);
            }
            return positions;
        },

        /**
         * @param {number[]} origin - Ray origin.
         * @param {number[]} direction - Unit ray direction.
         * @returns {Promise<{ position: number[] }|null>} Where it took hold.
         */
        grab: (origin, direction) => sim.grab(origin, direction),
        /** @param {number[]} position - Where the grab target goes. */
        moveGrab: position => sim.moveGrab(position),
        release: () => sim.releaseGrab(),
        destroy: () => sim.destroy()
    };
}
