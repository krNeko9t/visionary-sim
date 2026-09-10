/** Mount beside portable JSON controls; this panel owns no configuration data. */
export function mountLocalSceneConfiguration(host, controller, { document = globalThis.document } = {}) {
    const element = document.createElement('section');
    element.className = 'local-scene-configuration';
    element.setAttribute('aria-label', '浏览器本地准备配置');
    const save = document.createElement('button');
    save.type = 'button';
    save.textContent = '保存准备配置到浏览器';
    const read = document.createElement('button');
    read.type = 'button';
    read.textContent = '读取浏览器准备配置';
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const guidance = document.createElement('p');
    guidance.className = 'instance-note';
    guidance.textContent = '仅手动保存准备配置，不保存源文件或模拟进度。重开后需重选三个源文件。请使用旁边的 JSON 导出保留恢复副本；浏览器记录清理后可导入该副本，无副本无法找回。';
    element.append(save, read, status, guidance);
    host.append(element);
    const saveLocal = () => controller.saveLocal();
    const loadLocal = () => controller.loadLocal();
    save.addEventListener('click', saveLocal);
    read.addEventListener('click', loadLocal);
    const unsubscribe = controller.subscribe(state => {
        save.disabled = read.disabled = Boolean(state.busy);
        status.textContent = state.message + (state.detail ? `（${state.detail}）` : '');
    });
    const ready = controller.loadLocal();
    let disposed = false;
    return Object.freeze({
        element, ready,
        dispose() {
            if (disposed) return;
            disposed = true;
            unsubscribe();
            save.removeEventListener('click', saveLocal);
            read.removeEventListener('click', loadLocal);
            element.remove();
        }
    });
}
