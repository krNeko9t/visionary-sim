import './sceneImport.css';

/** Mount the formal three-file import surface and the observable instance directory. */
export function mountSceneImport({ host = document.body, session, capabilities }) {
    const panel = element('section', 'scene-import');
    const heading = element('h1', '', '场景实例工作台');
    const capability = element('p', 'scene-import__capability');
    capability.textContent = capabilities.available
        ? '本机文件、Worker、NPZ 解压与 WebGPU 已可用'
        : `当前无法导入：缺少 ${capabilities.missing.join('、')}`;
    const form = element('form', 'scene-import__files');
    const slots = [
        fileSlot('几何 PLY', '.ply', 'geometry'),
        fileSlot('标签 NPZ', '.npz', 'labels'),
        fileSlot('物性 JSON', '.json,application/json', 'physics')
    ];
    const submit = element('button', 'scene-import__primary', '导入并显示');
    submit.type = 'submit';
    submit.disabled = !capabilities.available;
    const cancel = element('button', '', '取消后台任务');
    cancel.type = 'button';
    cancel.hidden = true;
    form.append(...slots.map(slot => slot.label), submit, cancel);
    const status = element('p', 'scene-import__status', '请选择三个文件');
    status.setAttribute('role', 'status');
    const notice = element('p', 'scene-import__notice', '结构检查不能证明三个同规模文件同源；导入后请用实例着色核查。');
    const directoryHeading = element('h2', '', '实例目录');
    const directory = element('ol', 'scene-import__directory');
    directory.append(element('li', 'scene-import__empty', '尚未导入场景'));
    panel.append(heading, capability, form, status, notice, directoryHeading, directory);
    host.append(panel);

    form.addEventListener('submit', submitImport);
    cancel.addEventListener('click', session.cancelImport);
    for (const { input } of slots) input.addEventListener('change', cancelForFileChange);
    const unsubscribe = session.subscribe(render);

    function submitImport(event) {
        event.preventDefault();
        const files = Object.fromEntries(slots.map(({ name, input }) => [name, input.files?.[0]]));
        session.importScene(files).catch(() => {});
    }

    function render(state) {
        const progress = state.import;
        const availableCounts = [];
        if (progress.counts?.gaussians !== undefined) availableCounts.push(`${number(progress.counts.gaussians)} 个高斯`);
        if (progress.counts?.instances !== undefined) availableCounts.push(`${number(progress.counts.instances)} 个实例`);
        const countText = availableCounts.length ? ` · ${availableCounts.join(' · ')}` : '';
        status.textContent = `${progress.message}${countText}`;
        status.dataset.status = progress.status;
        cancel.hidden = !progress.cancellable;
        submit.disabled = !capabilities.available || progress.status === 'running';
        if (!state.scene) return;
        directory.replaceChildren();
        const prepared = state.scene.prepared;
        for (const instance of prepared.instances) {
            const item = element('li', 'scene-import__instance');
            const title = element('span', '', `${instance.id} · ${instance.name}`);
            const detail = element('small', '', `${number(instance.count)} 个高斯`);
            if (!instance.material.valid) detail.textContent += ` · 待补：${instance.material.issues.join('、')}`;
            item.append(title, detail);
            directory.append(item);
        }
        const untracked = element('li', 'scene-import__instance scene-import__instance--untracked');
        untracked.append(element('span', '', '0 · 未追踪内容'), element('small', '', `${number(prepared.untrackedCount)} 个高斯 · 仅显示`));
        directory.append(untracked);
    }

    return {
        element: panel,
        dispose() {
            unsubscribe();
            form.removeEventListener('submit', submitImport);
            cancel.removeEventListener('click', session.cancelImport);
            for (const { input } of slots) input.removeEventListener('change', cancelForFileChange);
            panel.remove();
        }
    };

    function cancelForFileChange() {
        session.cancelImport();
    }
}

function fileSlot(title, accept, name) {
    const input = element('input');
    input.type = 'file';
    input.accept = accept;
    input.required = true;
    input.name = name;
    const label = element('label', 'scene-import__slot');
    label.append(element('span', '', title), input);
    return { name, input, label };
}

function element(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

function number(value) {
    return Number(value ?? 0).toLocaleString();
}
