/** Start one dedicated worker for one candidate import. Cancellation terminates it. */
export function createSceneImportTask(files, onProgress = () => {}, {
    WorkerClass,
    workerUrl
} = {}) {
    validateFiles(files);
    // Keep the production constructor statically visible to Vite so imports in
    // the Worker are bundled, rather than embedded as an unresolved data URL.
    const worker = WorkerClass
        ? new WorkerClass(workerUrl, { type: 'module', name: 'scene-import' })
        : new Worker(new URL('./worker.js', import.meta.url), { type: 'module', name: 'scene-import' });
    let settled = false;
    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
    });
    const finish = (operation, value) => {
        if (settled) return;
        settled = true;
        worker.terminate();
        operation(value);
    };
    worker.onmessage = ({ data }) => {
        if (settled) return;
        if (data.type === 'progress') onProgress(data.progress);
        else if (data.type === 'result') finish(resolvePromise, data.result);
        else if (data.type === 'error') {
            const error = new Error(data.error.message);
            error.phase = data.error.phase;
            error.file = data.error.file;
            finish(rejectPromise, error);
        }
    };
    worker.onerror = event => finish(rejectPromise, new Error(event.message || '场景导入 Worker 失败'));
    try {
        worker.postMessage({ files });
    } catch (error) {
        settled = true;
        worker.terminate();
        throw error;
    }
    return {
        promise,
        cancel() {
            if (settled) return;
            settled = true;
            worker.terminate();
            const error = new Error('导入已取消');
            error.name = 'ImportCancelledError';
            rejectPromise(error);
        }
    };
}

function validateFiles(files) {
    const slots = [['geometry', '.ply'], ['labels', '.npz'], ['physics', '.json']];
    if (!files || typeof files !== 'object') throw new Error('请选择 PLY、NPZ 和 JSON 三个文件');
    for (const [slot, suffix] of slots) {
        const file = files[slot];
        if (!file || typeof file.name !== 'string') throw new Error(`缺少 ${slot} 文件`);
        if (!file.name.toLowerCase().endsWith(suffix)) throw new Error(`${file.name}: ${slot} 文件应为 ${suffix}`);
    }
}

/** Report actual APIs and the already-created graphics device, not a browser-name guess. */
export function detectSceneImportCapabilities({ graphicsDevice, environment = globalThis } = {}) {
    const missing = [];
    if (typeof environment.Worker !== 'function') missing.push('Web Worker');
    if (typeof environment.File !== 'function' || typeof environment.Blob !== 'function') missing.push('File/Blob');
    try {
        if (typeof environment.DecompressionStream !== 'function') throw new Error('missing');
        new environment.DecompressionStream('deflate-raw');
    } catch {
        missing.push('deflate-raw decompression');
    }
    if (!graphicsDevice?.isWebGPU) missing.push('WebGPU device');
    return { available: missing.length === 0, missing };
}
