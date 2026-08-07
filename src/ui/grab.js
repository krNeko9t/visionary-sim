import { Vec3 } from 'playcanvas';

/**
 * Reaching into the tank with the pointer.
 *
 * Press, and the node under the pointer is pinned to it; drag, and the body
 * follows; release, and it is handed back to the solver. This is the whole
 * reason the simulation is interactive rather than a film, so it is worth the
 * two awkward parts:
 *
 *   - The answer to "what did I just click" lives on the GPU, so it arrives a
 *     frame late. The camera is stopped on the press and given back on a miss,
 *     rather than the other way round -- a dropped frame of orbit is invisible,
 *     a body that lurches because the camera also moved is not.
 *   - A pointer is a line and a grab needs a point, so the drag runs on the
 *     plane through the grabbed node facing the camera. Every other choice
 *     makes the body run towards or away from the viewer on its own.
 */

/** How far outside the tank a dragged node may be pulled. */
const REACH = 0.02;

/**
 * @param {import('playcanvas').AppBase} app - The application.
 * @param {import('playcanvas').Entity} camera - Camera the pointer is looking through.
 * @param {import('../sim/simulator.js').Simulator} sim - Simulation to reach into.
 * @param {{ enableOrbit: boolean, enablePan: boolean }} controls - Camera controls to
 *   suspend while dragging, so one drag does not do two things.
 * @returns {{ detach: () => void }} Handle that unbinds the listeners.
 */
export function attachGrabber(app, camera, sim, controls) {
    const canvas = app.graphicsDevice.canvas;
    const near = new Vec3();
    const far = new Vec3();
    const direction = new Vec3();
    const toPlane = new Vec3();

    /** The press being handled, if any. Identity is the guard against a stale pick. */
    let press = null;

    /**
     * @param {boolean} enabled - Whether the camera may respond to the pointer.
     */
    const setCameraEnabled = (enabled) => {
        controls.enableOrbit = enabled;
        controls.enablePan = enabled;
    };

    /**
     * @param {number} x - Pointer x in canvas pixels.
     * @param {number} y - Pointer y in canvas pixels.
     * @returns {{ origin: number[], direction: number[] }} The ray under the pointer.
     */
    const rayThrough = (x, y) => {
        camera.camera.screenToWorld(x, y, camera.camera.nearClip, near);
        camera.camera.screenToWorld(x, y, camera.camera.farClip, far);
        direction.sub2(far, near).normalize();
        return { origin: [near.x, near.y, near.z], direction: [direction.x, direction.y, direction.z] };
    };

    /**
     * Moves the grabbed node to wherever the pointer now points, on the plane
     * the grab started from.
     */
    const dragToPointer = () => {
        const ray = rayThrough(press.x, press.y);
        const normal = camera.forward;
        toPlane.set(
            press.plane[0] - ray.origin[0],
            press.plane[1] - ray.origin[1],
            press.plane[2] - ray.origin[2]
        );
        const along = normal.dot(direction);
        if (Math.abs(along) < 1e-6) {
            return;
        }

        const distance = normal.dot(toPlane) / along;
        const { min, max } = sim.tank;
        sim.setGrabTarget([0, 1, 2].map(axis => Math.min(
            Math.max(ray.origin[axis] + ray.direction[axis] * distance, min[axis] - REACH),
            max[axis] + REACH
        )));
    };

    const release = () => {
        if (!press) {
            return;
        }
        press = null;
        sim.setGrab(-1, -1);
        setCameraEnabled(true);
        canvas.style.cursor = '';
    };

    /**
     * @param {PointerEvent} event - The press.
     */
    const onPointerDown = (event) => {
        if (event.button !== 0) {
            return;
        }
        const started = { x: event.offsetX, y: event.offsetY, plane: null };
        press = started;
        setCameraEnabled(false);

        const ray = rayThrough(started.x, started.y);
        sim.pick(ray.origin, ray.direction).then((hit) => {
            // The pointer may have been released, or pressed again, while the
            // readback was in flight.
            if (press !== started) {
                return;
            }
            if (!hit) {
                release();
                return;
            }
            started.plane = hit.position;
            sim.setGrab(hit.bodyIndex, hit.node);
            canvas.style.cursor = 'grabbing';
            dragToPointer();
        });
    };

    /**
     * @param {PointerEvent} event - The move.
     */
    const onPointerMove = (event) => {
        if (!press) {
            return;
        }
        press.x = event.offsetX;
        press.y = event.offsetY;
        if (press.plane) {
            dragToPointer();
        }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);

    return {
        detach() {
            release();
            canvas.removeEventListener('pointerdown', onPointerDown);
            canvas.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', release);
            window.removeEventListener('pointercancel', release);
        }
    };
}
