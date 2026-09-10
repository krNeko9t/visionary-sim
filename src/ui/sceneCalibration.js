import { Color, Entity, Gizmo, Quat, RotateGizmo, ScaleGizmo, TranslateGizmo, Vec3 } from 'playcanvas';

/** Capture-phase bridge for the engine's real hit-tested gizmos and the shared ledger. */
export function attachContainerGizmoPointer({ canvas, ownership, getGizmo, invalidate }) {
    let held = null;
    const stop = event => { event.preventDefault(); event.stopImmediatePropagation(); };
    const coords = event => {
        const rect = canvas.getBoundingClientRect();
        return [event.clientX - rect.left, event.clientY - rect.top];
    };
    const finish = () => {
        if (!held) return;
        const { id, gizmo } = held;
        held = null;
        gizmo.fire('pointer:up');
        ownership.release(id, 'container-gizmo');
        if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    };
    const down = event => {
        const gizmo = getGizmo();
        if (held || event.button !== 0 || event.isPrimary === false || !gizmo?.enabled) return;
        const [x, y] = coords(event);
        // PlayCanvas 2.21's hit tester is private; keep that coupling at this bridge.
        const hit = gizmo._getSelection(x, y)[0];
        if (!hit || !ownership.claim(event.pointerId, 'container-gizmo')) return;
        held = { id: event.pointerId, gizmo };
        stop(event); invalidate(); canvas.setPointerCapture(event.pointerId);
        gizmo.fire('pointer:down', x, y, hit);
    };
    const move = event => {
        const gizmo = held?.gizmo ?? getGizmo();
        if (!gizmo?.enabled) return;
        if (held && (held.id !== event.pointerId || ownership.ownerOf(event.pointerId) !== 'container-gizmo')) return;
        if (!held && ownership.ownerOf(event.pointerId)) return;
        const [x, y] = coords(event);
        if (held) stop(event);
        gizmo.fire('pointer:move', x, y, gizmo._getSelection(x, y)[0]);
    };
    const end = event => {
        if (held?.id !== event.pointerId) return;
        stop(event); finish();
    };
    const handlers = { pointerdown: down, pointermove: move, pointerup: end, pointercancel: end, lostpointercapture: end };
    for (const [name, fn] of Object.entries(handlers)) canvas.addEventListener(name, fn, true);
    return { cancel: finish, dispose() {
        finish();
        for (const [name, fn] of Object.entries(handlers)) canvas.removeEventListener(name, fn, true);
    } };
}

/** Production numeric controls, wireframe and translate/rotate/scale gizmos. */
export function mountSceneCalibration({ application, app, camera, canvas, host }) {
    const element = document.createElement('section');
    element.className = 'instance-catalog';
    const title = document.createElement('h2'); title.textContent = '全局校正与容器';
    const help = document.createElement('p'); help.textContent = '默认最长边 1 米是人为设定；不代表实测尺寸。世界网格 Y=0，不自动落地。';
    const fields = document.createElement('fieldset');
    const error = document.createElement('p'); error.setAttribute('role', 'status');
    const warning = document.createElement('p'); warning.setAttribute('role', 'status');
    element.append(title, help, fields, warning, error); host.append(element);
    let mode = null;
    let latest = null;
    const target = new Entity('scene-container-editor'); app.root.addChild(target);
    const layer = Gizmo.createLayer(app);
    const gizmos = { translate: new TranslateGizmo(camera.camera, layer), rotate: new RotateGizmo(camera.camera, layer), scale: new ScaleGizmo(camera.camera, layer) };
    for (const gizmo of Object.values(gizmos)) {
        // Remove automatic listeners so capture/ownership always precedes transforms.
        canvas.removeEventListener('pointerdown', gizmo._onPointerDown);
        canvas.removeEventListener('pointermove', gizmo._onPointerMove);
        canvas.removeEventListener('pointerup', gizmo._onPointerUp);
        gizmo.coordSpace = 'local';
        gizmo.on('transform:move', () => attempt(() => application.editContainer({
            position: array(target.getPosition()),
            orientation: array(target.getRotation()),
            dimensions: array(target.getLocalScale())
        })));
    }
    const pointer = attachContainerGizmoPointer({ canvas, ownership: application.pointerOwnership,
        getGizmo: () => latest?.preparationEditable && mode ? gizmos[mode] : null,
        invalidate: () => application.selectionOwner?.invalidate() });
    function syncTarget() {
        const pose = latest?.preparation?.container?.world;
        if (!pose) return;
        target.setPosition(...pose.position); target.setRotation(...pose.orientation); target.setLocalScale(...pose.dimensions);
    }
    function attempt(action) {
        try { action(); error.textContent = ''; }
        catch (reason) { error.textContent = reason.message; syncTarget(); }
    }
    const bindings = [];
    const up = document.createElement('select'); up.setAttribute('aria-label', '源上轴');
    for (const axis of ['+Y', '-Y', '+Z', '-Z', '+X', '-X']) {
        const option = document.createElement('option'); option.value = axis; option.textContent = axis; up.append(option);
    }
    up.onchange = () => attempt(() => application.setCalibration({ upAxis: up.value })); fields.append(up);
    function numbers(label, key, size, read, change) {
        const row = document.createElement('div'); row.append(document.createTextNode(label));
        const inputs = Array.from({ length: size }, (_, axis) => {
            const input = document.createElement('input'); input.type = 'number'; input.step = 'any';
            input.style.width = '72px'; input.setAttribute('aria-label', `${label}${size > 1 ? ' XYZ'[axis + 1] : ''}`);
            input.onchange = () => attempt(() => {
                if (inputs.some(node => node.value.trim() === '')) throw new Error('请输入有限数值');
                change(inputs.map(node => Number(node.value)));
            });
            row.append(input); return input;
        });
        fields.append(row); bindings.push({ key, inputs, read });
    }
    numbers('手工角度 °', 'manual', 3, p => p.calibration.manualDegrees, v => application.setCalibration({ manualDegrees: v }));
    numbers('参考最长边 m', 'length', 1, p => [p.calibration.longestMeters], v => application.setCalibration({ longestMeters: v[0] }));
    numbers('场景中心 m', 'position', 3, p => p.calibration.position, v => application.setCalibration({ position: v }));
    const tools = document.createElement('div');
    for (const [value, label] of [[null, '观察 / 选择'], ['translate', '容器平移'], ['rotate', '容器旋转'], ['scale', '容器尺寸']]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
        button.onclick = () => { pointer.cancel(); mode = value; attach(); }; tools.append(button);
    }
    fields.append(tools);
    numbers('容器位置 m', 'boxPosition', 3, p => p.container.world.position, v => application.editContainer({ position: v }));
    numbers('容器角度 °', 'boxRotation', 3, p => array(new Quat(...p.container.world.orientation).getEulerAngles()), v => application.editContainer({ rotationDegrees: v }));
    numbers('容器内部尺寸 m', 'boxSize', 3, p => p.container.world.dimensions, v => application.editContainer({ dimensions: v }));
    function attach() {
        for (const g of Object.values(gizmos)) g.detach();
        if (mode && latest?.preparationEditable) gizmos[mode].attach([target]);
        [...tools.children].forEach((button, index) => button.setAttribute('aria-pressed', String(index === [null, 'translate', 'rotate', 'scale'].indexOf(mode))));
    }
    const unsubscribe = application.subscribe(state => {
        const wasEditable = latest?.preparationEditable;
        const changedScene = latest?.scene !== state.scene;
        latest = state;
        element.hidden = !state.scene;
        fields.disabled = !state.preparationEditable;
        syncTarget();
        if (changedScene || wasEditable !== state.preparationEditable) { pointer.cancel(); attach(); }
        const p = state.preparation;
        warning.textContent = p?.error ?? p?.containment?.warning ?? '';
        if (!p?.transform) return;
        up.value = p.calibration.upAxis;
        for (const binding of bindings) binding.read(p).forEach((value, index) => {
            binding.inputs[index].value = String(Number(value.toPrecision(10)));
        });
    });
    const draw = () => {
        if (!latest?.preparation?.container) return;
        app.drawWireAlignedBox(new Vec3(-.5, -.5, -.5), new Vec3(.5, .5, .5), new Color(.4, .8, .75), true, undefined, target.getWorldTransform());
    };
    app.on('update', draw);
    return { element, dispose() {
        unsubscribe(); pointer.dispose(); app.off('update', draw);
        for (const g of Object.values(gizmos)) g.destroy();
        app.scene.layers.remove(layer); target.destroy(); element.remove();
    } };
}

function array(value) { return value.w === undefined ? [value.x, value.y, value.z] : [value.x, value.y, value.z, value.w]; }
