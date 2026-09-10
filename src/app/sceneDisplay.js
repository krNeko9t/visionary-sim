import { createSceneSplatCandidate } from './import/views.js';
import { createGpuCandidate } from './gpuCandidate.js';
import { setSceneDisplayProbe, isSceneDisplayProbeReady } from '../render/instanceColors.js';

/**
 * Owns source display validation from allocation through the final configured
 * render frame. validate(stage) must finish before the synchronous attach commit.
 * dispose also waits for outstanding error scopes to close.
 */
export async function createSceneDisplayCandidate(app, prepared, {
    signal, createViews = createSceneSplatCandidate
} = {}) {
    const controller = new AbortController();
    const constructed = deferred();
    const requested = deferred();
    let raw = null;
    let released = false;
    let validated = false;
    let published = false;
    let validation = null;
    const release = () => {
        if (released) return;
        released = true;
        raw?.dispose();
    };
    const abort = () => {
        controller.abort();
        if (raw && !published) raw.views.root.enabled = false;
        requested.resolve(null);
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const completion = createGpuCandidate({
        graphicsDevice: app.graphicsDevice,
        signal: controller.signal,
        create() {
            raw = createViews(app, prepared);
            raw.views.root.enabled = false;
            constructed.resolve();
            return { dispose: release };
        },
        async validate() {
            const stage = await requested.promise;
            assertActive();
            await stage?.(raw.views);
            assertActive();
            await probeFrame(app, raw, controller.signal);
        }
    });
    // The transaction can be cancelled before anyone calls validate. Observe
    // its rejection immediately, while still returning it to validate callers.
    completion.catch(error => { constructed.reject(error); });
    try { await constructed.promise; } catch (error) {
        signal?.removeEventListener('abort', abort);
        release();
        throw error;
    }
    function assertActive() {
        if (controller.signal.aborted || released) throw new DOMException('显示准备已取消', 'AbortError');
    }
    return {
        views: raw.views,
        validate(stage) {
            if (validation) return validation;
            requested.resolve(stage);
            validation = completion.then(() => {
                assertActive();
                validated = true;
            });
            return validation;
        },
        attach() {
            assertActive();
            if (!validated) throw new Error('source display validation is not complete');
            setSceneDisplayProbe(raw.views.groups, false);
            raw.views.root.enabled = true;
            published = true;
            signal?.removeEventListener('abort', abort);
        },
        async dispose() {
            raw.views.root.enabled = false;
            signal?.removeEventListener('abort', abort);
            if (!published) abort();
            try { await completion; } catch {} finally { release(); }
        }
    };
}

function deferred() {
    let resolve, reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}

function probeFrame(app, raw, signal) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let timer;
        const finish = error => {
            if (settled) return;
            settled = true;
            app.off('update', update);
            app.off('frameend', frameend);
            signal.removeEventListener('abort', cancel);
            clearTimeout(timer);
            raw.views.root.enabled = false;
            // Keep the transparent workbuffer until publication. The modifier
            // is unchanged at commit; its uniform then restores source alpha.
            if (error) reject(error); else resolve();
        };
        const cancel = () => finish(new DOMException('显示准备已取消', 'AbortError'));
        const frameend = () => {
            try {
                if (isSceneDisplayProbeReady(raw.views.groups)) finish();
            } catch (error) { finish(error); }
        };
        const update = () => {
            app.off('update', update);
            try {
                setSceneDisplayProbe(raw.views.groups, true);
                raw.attach();
                raw.views.root.enabled = true;
                app.on('frameend', frameend);
                timer = setTimeout(() => finish(new Error('source display render probe timed out')), 30000);
            } catch (error) { finish(error); }
        };
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) cancel();
        else app.on('update', update);
    });
}
