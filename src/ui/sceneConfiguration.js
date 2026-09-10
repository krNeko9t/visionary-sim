import './sceneConfiguration.css';

/** Real file-input and download events; local-save UI may mount in storageHost. */
export function mountSceneConfiguration({ host = document.body, controller, document: doc = host.ownerDocument, url = URL }) {
    const panel = doc.createElement('section');
    panel.className = 'scene-configuration';
    panel.setAttribute('aria-label', '可移植准备配置');
    const title = doc.createElement('h2');
    title.textContent = '准备配置';
    const status = doc.createElement('p');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const download = doc.createElement('button');
    download.type = 'button'; download.textContent = '导出 JSON';
    const configLabel = doc.createElement('label');
    configLabel.textContent = '导入配置 JSON';
    const configInput = doc.createElement('input');
    configInput.type = 'file'; configInput.accept = '.json,application/json';
    configInput.name = 'preparation-configuration'; configLabel.append(configInput);
    const form = doc.createElement('form');
    const slots = ['geometry', 'labels', 'physics'].map((slot, index) => {
        const label = doc.createElement('label');
        const text = doc.createElement('span');
        const input = doc.createElement('input');
        input.type = 'file'; input.name = slot; input.required = true;
        input.accept = ['.ply', '.npz', '.json'][index];
        label.append(text, input); form.append(label);
        return { slot, text, input };
    });
    const submit = doc.createElement('button');
    submit.type = 'submit'; submit.textContent = '关联三个源文件并恢复';
    const cancel = doc.createElement('button');
    cancel.type = 'button'; cancel.textContent = '取消关联';
    form.append(submit, cancel);
    const storageHost = doc.createElement('div');
    panel.append(title, download, configLabel, form, status, storageHost);
    host.append(panel);
    let disposed = false;
    let readRevision = 0;
    const urls = new Set();
    const report = error => { if (!disposed) status.textContent = error.message; };
    const onDownload = () => {
        let href;
        try {
            const text = controller.exportJSON();
            href = url.createObjectURL(new Blob([text], { type: 'application/json' }));
            urls.add(href);
            const link = doc.createElement('a');
            link.href = href; link.download = 'scene-preparation.json';
            panel.append(link);
            try { link.click(); } finally { link.remove(); }
            status.textContent = '已请求下载准备配置 JSON。';
            // Keep the URL alive for browser download processing, then release it.
            setTimeout(() => { if (urls.delete(href)) url.revokeObjectURL(href); }, 1000);
        } catch (error) {
            if (href && urls.delete(href)) url.revokeObjectURL(href);
            report(error);
        }
    };
    const onConfig = async () => {
        const revision = ++readRevision;
        const file = configInput.files?.[0];
        if (!file) return;
        try {
            const text = await file.text();
            if (!disposed && revision === readRevision) controller.importConfiguration(text);
        } catch (error) { if (revision === readRevision) report(error); }
        finally { if (!disposed && revision === readRevision) configInput.value = ''; }
    };
    const onSubmit = event => {
        event.preventDefault();
        // The controller publishes errors only for its current operation, so a
        // cancelled file read cannot overwrite a newer operation's UI status.
        controller.associateSources(Object.fromEntries(slots.map(({ slot, input }) => [slot, input.files?.[0]])))
            .catch(() => {});
    };
    const onCancel = () => controller.cancel();
    download.addEventListener('click', onDownload);
    configInput.addEventListener('change', onConfig);
    form.addEventListener('submit', onSubmit);
    cancel.addEventListener('click', onCancel);
    for (const { input } of slots) input.addEventListener('change', onCancel);
    const unsubscribe = controller.subscribe(state => {
        status.textContent = state.message;
        form.hidden = !state.pending;
        submit.disabled = state.status === 'reading-sources';
        cancel.hidden = state.status !== 'reading-sources';
        for (const { slot, text } of slots) text.textContent = `${{ geometry: '几何 PLY', labels: '标签 NPZ', physics: '物性 JSON' }[slot]}：${state.pending?.sources[slot].name ?? ''}`;
    });
    return {
        element: panel, storageHost,
        dispose() {
            disposed = true; ++readRevision; unsubscribe();
            download.removeEventListener('click', onDownload);
            configInput.removeEventListener('change', onConfig);
            form.removeEventListener('submit', onSubmit);
            cancel.removeEventListener('click', onCancel);
            for (const { input } of slots) input.removeEventListener('change', onCancel);
            for (const href of urls) url.revokeObjectURL(href);
            urls.clear(); panel.remove();
        }
    };
}
