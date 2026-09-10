export class ImportCancelledError extends Error {
    constructor() {
        super('导入已取消');
        this.name = 'ImportCancelledError';
    }
}

/** Owns the currently published scene and atomically replaces it with imports. */
export class SceneSession {
    constructor({ prepareTask, createViews, prepareScene }) {
        this.prepareTask = prepareTask;
        this.createViews = createViews;
        this.prepareScene = prepareScene;
        this.listeners = new Set();
        this.generation = 0;
        this.active = null;
        this.disposed = false;
        this.pendingCleanup = new Set();
        this.disposePromise = null;
        this.state = { scene: null, import: idleImport() };
    }

    getState = () => this.state;

    subscribe = (listener) => {
        this.listeners.add(listener);
        try {
            listener(this.state);
        } catch (error) {
            console.error('[scene-session] subscriber failed', error);
        }
        return () => this.listeners.delete(listener);
    };

    importScene = async (files) => {
        const transaction = await this.prepareImport(files);
        return transaction.commit();
    };

    /**
     * Normal imports return a validated transaction. Configuration restoration
     * uses deferValidation, then awaits transaction.validate(stageScene) before
     * the synchronous commit. Disposal waits for outstanding GPU scope cleanup.
     */
    prepareImport = async (files, { signal, deferValidation = false } = {}) => {
        if (this.disposed) throw new Error('scene session has been disposed');
        if (signal?.aborted) throw new ImportCancelledError();
        this.cancelImport();
        const generation = ++this.generation;
        const controller = new AbortController();
        let finishPreparing;
        const preparing = new Promise(resolve => { finishPreparing = resolve; });
        this.trackCleanup(preparing);
        let task = null;
        let candidate = null;
        let release = null;
        this.active = { cancel: () => {
            controller.abort();
            task?.cancel();
            return release?.();
        } };
        const abort = () => { if (generation === this.generation) this.cancelImport(); };
        signal?.addEventListener('abort', abort, { once: true });
        const stopListening = () => signal?.removeEventListener('abort', abort);
        this.updateImport({ status: 'running', phase: 'reading', message: '读取三个已选择文件', counts: null, cancellable: true, error: null });
        try {
            task = this.prepareTask(files, progress => {
                if (generation !== this.generation) return;
                this.updateImport({ status: 'running', cancellable: true, ...progress });
            });
            const prepared = await task.promise;
            if (generation !== this.generation) throw new ImportCancelledError();
            const gaussianCount = prepared.count ?? 0;
            const instanceCount = prepared.instances?.length ?? 0;
            this.updateImport({ status: 'running', phase: 'display', message: '创建 2DGS 显示资源', counts: { gaussians: gaussianCount, instances: instanceCount }, cancellable: true });
            candidate = await this.createViews(prepared, { signal: controller.signal });
            if (generation !== this.generation) {
                await candidate.dispose();
                throw new ImportCancelledError();
            }
            let consumed = false;
            let released = false;
            let cleanup = null;
            release = () => {
                if (released) return cleanup;
                released = true;
                try {
                    const result = candidate.dispose();
                    cleanup = result?.then ? this.trackCleanup(Promise.resolve(result).catch(error => {
                        console.error('[scene-session] candidate cleanup failed', error);
                    })) : null;
                } catch (error) {
                    console.error('[scene-session] candidate cleanup failed', error);
                }
                return cleanup;
            };
            const scene = { prepared, views: candidate.views, dispose: release };
            let validated = false;
            let validation = null;
            const transaction = {
                prepared, views: candidate.views, scene,
                validate: (stage = this.prepareScene) => {
                    if (consumed || generation !== this.generation || this.disposed) return Promise.reject(new ImportCancelledError());
                    if (validation) return validation;
                    validation = (async () => {
                        try {
                            if (candidate.validate) await candidate.validate(() => stage?.(scene));
                            else await stage?.(scene);
                            if (consumed || generation !== this.generation || this.disposed) throw new ImportCancelledError();
                            validated = true;
                        } catch (error) {
                            controller.abort();
                            await release();
                            stopListening();
                            if (generation !== this.generation || this.disposed) throw new ImportCancelledError();
                            consumed = true;
                            this.active = null;
                            this.updateImport({ status: 'failed', cancellable: false, error: error.message, message: error.message });
                            throw error;
                        }
                    })();
                    return validation;
                },
                commit: () => {
                    if (consumed || generation !== this.generation || this.disposed) throw new ImportCancelledError();
                    if (!validated) throw new Error('source display validation is not complete');
                    try { candidate.attach(); } catch (error) {
                        consumed = true;
                        stopListening();
                        release();
                        this.active = null;
                        this.updateImport({ status: 'failed', cancellable: false, error: error.message, message: error.message });
                        throw error;
                    }
                    consumed = true;
                    stopListening();
                    this.active = null;
                    const previous = this.state.scene;
                    this.state = {
                        scene,
                        import: { status: 'ready', phase: 'ready', message: `${gaussianCount.toLocaleString()} 个高斯已显示`, counts: { gaussians: gaussianCount, instances: instanceCount }, cancellable: false, error: null }
                    };
                    this.emit();
                    try { previous?.dispose(); } catch (error) {
                        console.error('[scene-session] replaced scene cleanup failed', error);
                    }
                    return scene;
                },
                dispose: () => {
                    if (consumed) return;
                    consumed = true;
                    stopListening();
                    controller.abort();
                    const cleanup = release();
                    if (generation === this.generation) {
                        this.active = null;
                        this.updateImport({ status: 'cancelled', cancellable: false, message: '候选已放弃；已有场景保持不变' });
                    }
                    return cleanup;
                }
            };
            this.active = { cancel: transaction.dispose };
            if (!deferValidation) await transaction.validate();
            return transaction;
        } catch (error) {
            controller.abort();
            await release?.();
            stopListening();
            if (generation !== this.generation || error?.name === 'ImportCancelledError') throw new ImportCancelledError();
            this.active = null;
            this.updateImport({ status: 'failed', cancellable: false, error: error.message, message: error.message });
            throw error;
        } finally {
            finishPreparing();
        }
    };

    cancelImport = () => {
        if (!this.active) return false;
        this.generation++;
        try {
            const cancelled = this.active.cancel();
            if (cancelled?.then) this.trackCleanup(cancelled);
        } catch (error) {
            console.error('[scene-session] import cancellation cleanup failed', error);
        }
        this.active = null;
        this.updateImport({ status: 'cancelled', phase: 'cancelled', message: '导入已取消；已有场景保持不变', counts: null, cancellable: false, error: null });
        return true;
    };

    dispose = () => {
        if (this.disposed) return this.disposePromise;
        this.cancelImport();
        this.disposed = true;
        this.generation++;
        try {
            const released = this.state.scene?.dispose();
            if (released?.then) this.trackCleanup(released);
        } catch (error) {
            console.error('[scene-session] scene cleanup failed', error);
        }
        this.state = { scene: null, import: idleImport() };
        this.emit();
        this.listeners.clear();
        this.disposePromise = this.pendingCleanup.size ? Promise.allSettled([...this.pendingCleanup]) : null;
        return this.disposePromise;
    };

    trackCleanup(promise) {
        this.pendingCleanup.add(promise);
        promise.then(() => this.pendingCleanup.delete(promise), () => this.pendingCleanup.delete(promise));
        return promise;
    }

    updateImport(patch) {
        this.state = { ...this.state, import: { ...this.state.import, ...patch } };
        this.emit();
    }

    emit() {
        for (const listener of this.listeners) {
            try {
                listener(this.state);
            } catch (error) {
                console.error('[scene-session] subscriber failed', error);
            }
        }
    }
}

function idleImport() {
    return { status: 'idle', phase: null, message: '请选择三个文件', counts: null, cancellable: false, error: null };
}
