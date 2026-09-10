import { Picker, Quat, Vec3 } from 'playcanvas';
import { attachSceneSelection } from './sceneSelection.js';

/** Actual engine picking and world-Y orbit/pan, sharing pointer ownership. */
export function attachSceneNavigation({ app, camera, canvas, ownership, getScene, select, onError }) {
    // Unified splat picking only maps placements back to components when IDs
    // are enabled; Picker.prepare alone does not enable the ID work-buffer.
    const previousIds = app.scene.gsplat.enableIds;
    app.scene.gsplat.enableIds = true;
    const picker = new Picker(app, canvas.width, canvas.height);
    const focus = new Vec3();
    const up = new Vec3(0, 1, 0);
    let gesture = null;
    let pickVersion = 0;
    const selection = attachSceneSelection({
        canvas, ownership, select,
        pick: async event => {
            const scene = getScene();
            if (!scene) return null;
            const version = ++pickVersion;
            try {
                picker.resize(canvas.width, canvas.height);
                picker.prepare(camera.camera, app.scene, [app.scene.layers.getLayerByName('World')]);
                const rect = canvas.getBoundingClientRect();
                const hits = await picker.getSelectionAsync(
                    (event.clientX - rect.left) * canvas.width / rect.width,
                    (event.clientY - rect.top) * canvas.height / rect.height);
                if (scene !== getScene() || version !== pickVersion) return undefined;
                return scene.views.groups.find(group => hits.includes(group.entity.gsplat))?.id ?? null;
            } catch (error) { onError(error.message); return undefined; }
        }
    });
    const down = event => {
        if (![1, 2].includes(event.button) || ownership.hasOtherOwner('camera') ||
            !ownership.claim(event.pointerId, 'camera')) return;
        gesture = { id: event.pointerId, button: event.button, x: event.clientX, y: event.clientY };
        selection.invalidate();
        canvas.setPointerCapture(event.pointerId);
        event.preventDefault();
    };
    const move = event => {
        if (!gesture || event.pointerId !== gesture.id || ownership.ownerOf(event.pointerId) !== 'camera') return;
        const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
        gesture.x = event.clientX; gesture.y = event.clientY;
        const offset = camera.getPosition().clone().sub(focus);
        if (gesture.button === 2) {
            new Quat().setFromAxisAngle(up, -dx * .25).transformVector(offset, offset);
            const candidate = new Quat().setFromAxisAngle(camera.right, -dy * .25).transformVector(offset);
            if (Math.abs(candidate.clone().normalize().dot(up)) < .995) offset.copy(candidate);
            camera.setPosition(focus.clone().add(offset));
            camera.lookAt(focus, up);
        } else {
            const shift = camera.right.clone().mulScalar(-dx * offset.length() * .0015)
                .add(camera.up.clone().mulScalar(dy * offset.length() * .0015));
            focus.add(shift); camera.setPosition(camera.getPosition().clone().add(shift));
        }
    };
    const end = event => {
        if (!gesture || gesture.id !== event.pointerId) return;
        ownership.release(event.pointerId, 'camera'); gesture = null;
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    const wheel = event => {
        event.preventDefault();
        if (ownership.hasOtherOwner('camera')) return;
        selection.invalidate();
        ++pickVersion;
        const offset = camera.getPosition().clone().sub(focus);
        offset.mulScalar(Math.exp(Math.max(-1, Math.min(1, event.deltaY * .001))));
        camera.setPosition(focus.clone().add(offset));
    };
    const context = event => event.preventDefault();
    const handlers = { pointerdown: down, pointermove: move, pointerup: end, pointercancel: end, lostpointercapture: end, wheel, contextmenu: context };
    for (const [name, handler] of Object.entries(handlers)) canvas.addEventListener(name, handler, { passive: false });
    return {
        selection,
        dispose() {
            selection.detach(); ++pickVersion; picker.destroy(); ownership.clear('camera');
            app.scene.gsplat.enableIds = previousIds;
            for (const [name, handler] of Object.entries(handlers)) canvas.removeEventListener(name, handler);
        }
    };
}
