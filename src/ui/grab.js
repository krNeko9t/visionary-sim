import { Vec3 } from 'playcanvas';

/**
 * Reaching into the tank with the pointer.
 *
 * The pointer has two jobs -- move the camera, move a body -- and they are
 * split by which button is held, not by any state this module keeps. Left is a
 * grab, right orbits, middle pans, wheel zooms. Nothing has to decide who owns
 * a drag once it has begun, because the button already decided.
 *
 * The camera controls bind their own listeners to the canvas, and their
 * `enableOrbit` flag does not gate the rotation they read from the mouse. So
 * the split is enforced where it cannot be argued with: these listeners sit on
 * `window` in the capture phase, ahead of anything on the canvas, and a left
 * button event is taken out of the propagation path before the camera can see
 * it. Everything else is passed through untouched.
 *
 * Two awkward parts remain, both inherent:
 *
 *   - The answer to "what did I just click" lives on the GPU, so it arrives a
 *     frame late. The press is recorded immediately and the grab starts when
 *     the answer lands.
 *   - A pointer is a line and a grab needs a point, so the drag runs on the
 *     plane through the grabbed node facing the camera. Every other choice
 *     makes the body run towards or away from the viewer on its own.
 */

/**
 * How far outside the tank the handle target may be pulled. Bounds the
 * handle, not the held nodes directly: with `sim/grip.js`'s `withinRadius`
 * strategy a held node can sit up to `REACH + this.grip.radius` outside the
 * tank, since it follows the handle at a fixed offset. Not tightened to
 * account for that -- those nodes carry zero inverse mass under the hard
 * drive law, so the tank's planes could not reach them regardless, the same
 * accepted cost `KinematicDrive` already carries for a single held node.
 */
const REACH = 0.02;

/**
 * @param {import('playcanvas').AppBase} app - The application.
 * @param {import('playcanvas').Entity} camera - Camera the pointer is looking through.
 * @param {{ tank: object, grab: Function, moveGrab: Function, releaseGrab: Function }} target - Application operations.
 * @param {{ownership?: object,owner?: string}} [options] - Shared pointer ledger.
 * @returns {{ detach: () => void }} Handle that unbinds the listeners.
 */
export function attachGrabber(app, camera, target, {
    ownership = null, owner = 'grab', onError = error => console.error('[grab] readback failed', error)
} = {}) {
    const canvas = app.graphicsDevice.canvas;
    const near = new Vec3();
    const far = new Vec3();
    const direction = new Vec3();
    const toPlane = new Vec3();

    /** The press being handled, if any. Identity is the guard against a stale pick. */
    let press = null;

    /**
     * Takes an event out of the propagation path. Called for exactly the events
     * this module handles, which is what keeps the camera off the left button.
     *
     * @param {PointerEvent} event - Event to claim.
     */
    const claim = (event) => {
        if (ownership && !ownership.claim(event.pointerId, owner)) return false;
        event.stopPropagation();
        event.preventDefault();
        return true;
    };

    /**
     * @param {PointerEvent} event - Event to locate.
     * @returns {{ origin: number[], direction: number[] }} The ray under the pointer.
     */
    const rayThrough = (event) => {
        const bounds = canvas.getBoundingClientRect();
        const x = event.clientX - bounds.left;
        const y = event.clientY - bounds.top;
        camera.camera.screenToWorld(x, y, camera.camera.nearClip, near);
        camera.camera.screenToWorld(x, y, camera.camera.farClip, far);
        direction.sub2(far, near).normalize();
        return { origin: [near.x, near.y, near.z], direction: [direction.x, direction.y, direction.z] };
    };

    /**
     * Moves the held node to wherever the pointer now points, on the plane
     * the grab started from.
     */
    const dragToPointer = () => {
        const ray = press.ray;
        const normal = camera.forward;
        // Read straight off `ray` rather than off whatever `rayThrough` left
        // in the module-level scratch vector -- the two happen to agree
        // whenever this runs today, but only because every caller calls
        // `rayThrough` immediately before it. Setting `direction` from `ray`
        // here removes that assumption instead of relying on it.
        direction.set(ray.direction[0], ray.direction[1], ray.direction[2]);
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
        const point = [0, 1, 2].map(axis => ray.origin[axis] + ray.direction[axis] * distance);
        const { min, max } = target.tank;
        // Legacy demo tanks retain their small outside reach. Scene containers
        // are rotated boxes and clamp exactly in Simulator.moveGrab, in their
        // own local coordinates.
        target.moveGrab(min && max ? point.map((value, axis) => Math.min(
            Math.max(value, min[axis] - REACH), max[axis] + REACH
        )) : point);
    };

    const release = () => {
        if (press) ownership?.release(press.pointerId, owner);
        press = null;
        target.releaseGrab();
        canvas.style.cursor = '';
    };

    /**
     * @param {PointerEvent} event - The press.
     */
    const onPointerDown = (event) => {
        if (event.button !== 0 || event.target !== canvas) {
            return;
        }
        if (!claim(event)) return;

        const started = { pointerId: event.pointerId, ray: rayThrough(event), plane: null };
        press = started;

        target.grab(started.ray.origin, started.ray.direction).then((hit) => {
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
            canvas.style.cursor = 'grabbing';
            dragToPointer();
        }).catch(error => {
            if (press !== started) return;
            release();
            onError(error);
        });
    };

    /**
     * @param {PointerEvent} event - The move.
     */
    const onPointerMove = (event) => {
        if (!press || event.pointerId !== press.pointerId ||
            (ownership && ownership.ownerOf(event.pointerId) !== owner)) {
            return;
        }
        event.stopPropagation();
        event.preventDefault();
        press.ray = rayThrough(event);
        if (press.plane) {
            dragToPointer();
        }
    };

    /**
     * @param {PointerEvent} event - The release.
     */
    const onPointerUp = (event) => {
        if (!press || event.pointerId !== press.pointerId) {
            return;
        }
        event.stopPropagation();
        event.preventDefault();
        release();
    };

    // Capture phase, on window: ahead of the camera's own listeners, which are
    // bound to the canvas. Listening here also means a drag that wanders off
    // the canvas -- over the panel, out of the window -- keeps being delivered.
    const listeners = [
        ['pointerdown', onPointerDown],
        ['pointermove', onPointerMove],
        ['pointerup', onPointerUp],
        ['pointercancel', onPointerUp]
    ];
    for (const [type, handler] of listeners) {
        window.addEventListener(type, handler, true);
    }

    return {
        detach() {
            release();
            ownership?.clear(owner);
            for (const [type, handler] of listeners) {
                window.removeEventListener(type, handler, true);
            }
        }
    };
}
