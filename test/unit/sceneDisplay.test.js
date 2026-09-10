import { describe, expect, it, vi } from 'vitest';
import { createSceneDisplayCandidate } from '../../src/app/sceneDisplay.js';
import { SceneSession } from '../../src/app/sceneSession.js';

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

function fixture({ scopeError = null, queue = Promise.resolve(), createError = null } = {}) {
    const listeners = new Map();
    const parameters = new Map();
    const root = { enabled: true, pose: 'initial' };
    const raw = {
        root, views: { root, groups: [{ id: 0, entity: { gsplat: {
            resource: { workBufferRenderInfos: new Map([['probe', { quadRender: { shader: { ready: true } } }]]) },
            setWorkBufferModifier: vi.fn(), setParameter: (key, value) => parameters.set(key, value)
        } } }] }, attach: vi.fn(), dispose: vi.fn()
    };
    const wgpu = {
        pushErrorScope: vi.fn(), popErrorScope: vi.fn(async () => scopeError),
        queue: { onSubmittedWorkDone: vi.fn(() => queue) }
    };
    const app = {
        graphicsDevice: { wgpu, submit: vi.fn() },
        on(name, fn) { listeners.set(name, [...(listeners.get(name) ?? []), fn]); },
        off(name, fn) { listeners.set(name, (listeners.get(name) ?? []).filter(value => value !== fn)); },
        fire(name) { for (const fn of [...(listeners.get(name) ?? [])]) fn(); }
    };
    const createViews = vi.fn(() => {
        expect(wgpu.pushErrorScope.mock.calls).toEqual([['out-of-memory'], ['validation']]);
        if (createError) throw createError;
        return raw;
    });
    const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
    return { app, raw, root, wgpu, parameters, createViews, flush, listeners };
}

describe('source display publication', () => {
    it('probes the final staged pose and colors, including label zero, and gates commit on queue completion', async () => {
        const queue = deferred();
        const f = fixture({ queue: queue.promise });
        const candidate = await createSceneDisplayCandidate(f.app, {}, { createViews: f.createViews });
        expect(() => candidate.attach()).toThrow(/validat/i);
        const validation = candidate.validate(views => { views.root.pose = 'configured'; });
        await f.flush();
        f.app.fire('update');
        expect(f.root.pose).toBe('configured');
        expect(f.root.enabled).toBe(true);
        expect(f.parameters.get('sourceDisplayProbe')).toBe(1);
        f.app.fire('frameend');
        await f.flush();
        expect(f.root.enabled).toBe(false);
        expect(() => candidate.attach()).toThrow(/validat/i);
        queue.resolve();
        await validation;
        candidate.attach();
        expect(f.root.enabled).toBe(true);
        expect(f.parameters.get('sourceDisplayProbe')).toBe(0);
        expect(f.wgpu.popErrorScope).toHaveBeenCalledTimes(2);
        await candidate.dispose();
        expect(f.raw.dispose).toHaveBeenCalledOnce();
    });

    it.each(['cancel', 'validation'])('keeps the old scene and cleans the candidate on %s during display validation', async kind => {
        const queue = deferred();
        const f = fixture({ queue: queue.promise, scopeError: kind === 'validation' ? { message: 'texture rejected' } : null });
        const old = { prepared: {}, views: {}, dispose: vi.fn() };
        const session = new SceneSession({
            prepareTask: () => ({ promise: Promise.resolve({}), cancel() {} }),
            createViews: (prepared, options) => createSceneDisplayCandidate(f.app, prepared, { ...options, createViews: f.createViews })
        });
        session.state = { ...session.state, scene: old };
        const importing = session.importScene({});
        const rejected = expect(importing).rejects.toThrow();
        await f.flush();
        expect(session.getState().import.status).toBe('running');
        f.app.fire('update'); f.app.fire('frameend');
        await f.flush();
        expect(f.wgpu.queue.onSubmittedWorkDone).toHaveBeenCalledOnce();
        expect(session.getState().scene).toBe(old);
        expect(old.dispose).not.toHaveBeenCalled();
        if (kind === 'cancel') session.cancelImport();
        queue.resolve();
        await rejected;
        expect(session.getState().scene).toBe(old);
        expect(old.dispose).not.toHaveBeenCalled();
        expect(f.raw.dispose).toHaveBeenCalledOnce();
        expect(f.wgpu.popErrorScope).toHaveBeenCalledTimes(2);
    });

    it('closes both scopes if construction throws', async () => {
        const f = fixture({ createError: new Error('construction failed') });
        await expect(createSceneDisplayCandidate(f.app, {}, { createViews: f.createViews })).rejects.toThrow('construction failed');
        await f.flush();
        expect(f.wgpu.popErrorScope).toHaveBeenCalledTimes(2);
    });

    it('closes scopes and releases an unvalidated staged candidate on cancellation', async () => {
        const f = fixture();
        const abort = new AbortController();
        const candidate = await createSceneDisplayCandidate(f.app, {}, { signal: abort.signal, createViews: f.createViews });
        abort.abort();
        await candidate.dispose();
        expect(f.wgpu.popErrorScope).toHaveBeenCalledTimes(2);
        expect(f.raw.dispose).toHaveBeenCalledOnce();
        expect(f.raw.attach).not.toHaveBeenCalled();
    });

    it('removes the pending update listener when cancelled before the first probe frame', async () => {
        const f = fixture();
        const abort = new AbortController();
        const candidate = await createSceneDisplayCandidate(f.app, {}, { signal: abort.signal, createViews: f.createViews });
        const validation = candidate.validate();
        const rejected = expect(validation).rejects.toThrow();
        await f.flush();
        expect(f.listeners.get('update')).toHaveLength(1);
        abort.abort();
        await rejected;
        expect(f.listeners.get('update')).toEqual([]);
        expect(f.listeners.get('frameend')).toEqual([]);
        expect(f.raw.attach).not.toHaveBeenCalled();
        expect(f.raw.dispose).toHaveBeenCalledOnce();
        expect(f.wgpu.popErrorScope).toHaveBeenCalledTimes(2);
    });
});
