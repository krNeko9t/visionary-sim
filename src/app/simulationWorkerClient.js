/** One CPU preparation candidate owns one Worker; cancellation terminates it. */
export function createSimulationPreparationTask(input, onProgress = () => {}, {
    WorkerClass,
    workerUrl
} = {}) {
    // Keep the production constructor statically visible to Vite so imports in
    // the Worker are bundled, rather than embedded as an unresolved data URL.
    const worker = WorkerClass
        ? new WorkerClass(workerUrl, { type: 'module', name: 'scene-simulation-preparation' })
        : new Worker(new URL('./simulationWorker.js', import.meta.url), { type: 'module', name: 'scene-simulation-preparation' });
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
        else if (data.type === 'error') finish(rejectPromise, new Error(data.error.message));
    };
    worker.onerror = event => finish(rejectPromise,
        new Error(event.message || '模拟准备 Worker 失败'));
    try {
        worker.postMessage({ input });
    } catch (error) {
        settled = true;
        worker.terminate();
        throw error;
    }
    return {
        promise,
        cancel() {
            if (settled) return false;
            settled = true;
            worker.terminate();
            const error = new Error('模拟准备已取消');
            error.name = 'SimulationPreparationCancelledError';
            rejectPromise(error);
            return true;
        }
    };
}
