/**
 * A pointer may belong to exactly one interaction until it is released.
 * Camera, gizmo, selection and grab adapters share this ledger instead of
 * inferring ownership from one another's side effects.
 */
export function createInteractionOwnership() {
    const owners = new Map();
    return Object.freeze({
        claim(pointerId, owner) {
            if (owners.has(pointerId)) return owners.get(pointerId) === owner;
            owners.set(pointerId, owner);
            return true;
        },
        release(pointerId, owner) {
            if (owners.get(pointerId) !== owner) return false;
            owners.delete(pointerId);
            return true;
        },
        ownerOf(pointerId) {
            return owners.get(pointerId) ?? null;
        },
        hasOtherOwner(owner) {
            return [...owners.values()].some(current => current !== owner);
        },
        clear(owner) {
            for (const [pointerId, current] of owners) {
                if (owner === undefined || current === owner) owners.delete(pointerId);
            }
        }
    });
}

/**
 * Adapts an existing camera, gizmo or grab surface to the shared ownership
 * ledger. Its own interaction code remains responsible for movement; this only
 * records which subsystem won the pointer.
 *
 * @param {object} options
 * @param {HTMLElement} options.target
 * @param {ReturnType<typeof createInteractionOwnership>} options.ownership
 * @param {'camera'|'gizmo'|'grab'|string} options.owner
 * @param {(event: PointerEvent) => boolean} options.shouldClaim
 */
export function attachPointerOwner({ target, ownership, owner, shouldClaim }) {
    const held = new Set();
    const pointerdown = event => {
        if (shouldClaim(event) && ownership.claim(event.pointerId, owner)) held.add(event.pointerId);
    };
    const release = event => {
        if (!held.has(event.pointerId)) return;
        ownership.release(event.pointerId, owner);
        held.delete(event.pointerId);
    };
    target.addEventListener('pointerdown', pointerdown);
    target.addEventListener('pointerup', release);
    target.addEventListener('pointercancel', release);
    target.addEventListener('lostpointercapture', release);
    return Object.freeze({
        detach() {
            target.removeEventListener('pointerdown', pointerdown);
            target.removeEventListener('pointerup', release);
            target.removeEventListener('pointercancel', release);
            target.removeEventListener('lostpointercapture', release);
            ownership.clear(owner);
            held.clear();
        }
    });
}

/**
 * Turns an unclaimed primary left click into the same stable ID selection used
 * by the catalog. Right/middle gestures remain camera-owned; moved pointers do
 * not become picks; late GPU picker results cannot overwrite newer intent.
 *
 * Register gizmo/grab ownership before this adapter, or provide
 * `isInteractionOwned`, so their left-button hit tests win before selection.
 *
 * @param {object} options
 * @param {HTMLElement} options.canvas
 * @param {(event: PointerEvent) => Promise<number|null>|number|null} options.pick
 * @param {(id: number|null) => void} options.select
 * @param {ReturnType<typeof createInteractionOwnership>} [options.ownership]
 * @param {(event: PointerEvent) => boolean} [options.isInteractionOwned]
 * @param {number} [options.dragThreshold]
 */
export function attachSceneSelection({
    canvas,
    pick,
    select,
    ownership = createInteractionOwnership(),
    isInteractionOwned = () => false,
    dragThreshold = 5
}) {
    let active = null;
    let generation = 0;
    let detached = false;
    const owner = 'selection';

    const pointerdown = event => {
        ++generation;
        if (active) return;
        if (event.button !== 0 || event.isPrimary === false || isInteractionOwned(event)) return;
        if (!ownership.claim(event.pointerId, owner)) return;
        active = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            moved: false
        };
        canvas.setPointerCapture?.(event.pointerId);
    };

    const pointermove = event => {
        if (!active || event.pointerId !== active.pointerId) return;
        if (Math.hypot(event.clientX - active.x, event.clientY - active.y) >= dragThreshold) {
            active.moved = true;
        }
    };

    const finish = (event, cancelled) => {
        if (!active || event.pointerId !== active.pointerId) return;
        const click = active;
        active = null;
        canvas.releasePointerCapture?.(event.pointerId);
        ownership.release(event.pointerId, owner);
        if (cancelled || click.moved || Math.hypot(event.clientX - click.x, event.clientY - click.y) >= dragThreshold || isInteractionOwned(event)) return;

        const token = ++generation;
        let result;
        try {
            result = pick(event);
        } catch {
            return;
        }
        Promise.resolve(result).then(id => {
            if (detached || token !== generation) return;
            if (id !== null && (!Number.isInteger(id) || id <= 0)) return;
            select(id);
        }).catch(() => {
            // Picking feedback belongs to the application status surface. A
            // failed pick does not change the current selection here.
        });
    };

    const pointerup = event => finish(event, false);
    const pointercancel = event => finish(event, true);
    canvas.addEventListener('pointerdown', pointerdown);
    canvas.addEventListener('pointermove', pointermove);
    canvas.addEventListener('pointerup', pointerup);
    canvas.addEventListener('pointercancel', pointercancel);

    return Object.freeze({
        ownership,
        invalidate() { ++generation; },
        detach() {
            if (detached) return;
            detached = true;
            ++generation;
            if (active) {
                canvas.releasePointerCapture?.(active.pointerId);
                ownership.release(active.pointerId, owner);
                active = null;
            }
            canvas.removeEventListener('pointerdown', pointerdown);
            canvas.removeEventListener('pointermove', pointermove);
            canvas.removeEventListener('pointerup', pointerup);
            canvas.removeEventListener('pointercancel', pointercancel);
        }
    });
}
