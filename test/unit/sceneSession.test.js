import { describe, expect, it } from 'vitest';

import { SceneSession } from '../../src/app/sceneSession.js';

function deferredTask() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject, cancel() {} };
}

function candidate(name, disposed) {
    return {
        views: name,
        attach() {},
        dispose() { disposed.push(name); }
    };
}

describe('SceneSession imports', () => {
    it('keeps the current scene until an explicitly prepared transaction commits synchronously', async () => {
        const disposed = [];
        const session = new SceneSession({
            prepareTask: files => ({ promise: Promise.resolve(files), cancel() {} }),
            createViews: prepared => candidate(prepared.name, disposed)
        });
        const old = await session.importScene({ name: 'old' });
        const transaction = await session.prepareImport({ name: 'restored' });
        expect(session.getState().scene).toBe(old);
        expect(disposed).toEqual([]);
        const next = transaction.commit();
        expect(next).toBe(session.getState().scene);
        expect(next.prepared.name).toBe('restored');
        expect(disposed).toEqual(['old']);
        expect(() => transaction.commit()).toThrow(/取消/);
    });

    it('discards a staged candidate on cancellation and forbids its late commit', async () => {
        const disposed = [];
        const session = new SceneSession({
            prepareTask: files => ({ promise: Promise.resolve(files), cancel() {} }),
            createViews: prepared => candidate(prepared.name, disposed)
        });
        const old = await session.importScene({ name: 'old' });
        const transaction = await session.prepareImport({ name: 'candidate' });
        session.cancelImport();
        expect(() => transaction.commit()).toThrow(/取消/);
        transaction.dispose();
        expect(disposed).toEqual(['candidate']);
        expect(session.getState().scene).toBe(old);
    });

    it('rolls back an attachment failure before publishing the candidate scene', async () => {
        const disposed = [];
        const session = new SceneSession({
            prepareTask: files => ({ promise: Promise.resolve(files), cancel() {} }),
            createViews: prepared => ({ views: prepared.name,
                attach() { if (prepared.name === 'broken') throw new Error('attach failed'); },
                dispose() { disposed.push(prepared.name); } })
        });
        const old = await session.importScene({ name: 'old' });
        const transaction = await session.prepareImport({ name: 'broken' });
        expect(() => transaction.commit()).toThrow('attach failed');
        transaction.dispose();
        expect(session.getState().scene).toBe(old);
        expect(session.getState().import.status).toBe('failed');
        expect(disposed).toEqual(['broken']);
    });
    it('publishes a complete candidate and disposes the replaced scene afterward', async () => {
        const tasks = [];
        const disposed = [];
        const session = new SceneSession({
            prepareTask: () => (tasks.push(deferredTask()), tasks.at(-1)),
            createViews: prepared => candidate(prepared.name, disposed)
        });
        const first = session.importScene({});
        tasks[0].resolve({ name: 'old' });
        await first;
        const second = session.importScene({});
        tasks[1].resolve({ name: 'new' });
        await second;
        expect(session.getState().scene.prepared.name).toBe('new');
        expect(disposed).toEqual(['old']);
    });

    it('keeps the displayed scene when view preparation fails', async () => {
        const tasks = [];
        const session = new SceneSession({
            prepareTask: () => (tasks.push(deferredTask()), tasks.at(-1)),
            createViews: prepared => {
                if (prepared.name === 'broken') throw new Error('GPU allocation failed');
                return candidate(prepared.name, []);
            }
        });
        const first = session.importScene({});
        tasks[0].resolve({ name: 'old' });
        await first;
        const failed = session.importScene({});
        tasks[1].resolve({ name: 'broken' });
        await expect(failed).rejects.toThrow('GPU allocation failed');
        expect(session.getState().scene.prepared.name).toBe('old');
        expect(session.getState().import.status).toBe('failed');
    });

    it('invalidates a cancelled task so its late result cannot replace the scene', async () => {
        const tasks = [];
        const session = new SceneSession({
            prepareTask: () => (tasks.push(deferredTask()), tasks.at(-1)),
            createViews: prepared => candidate(prepared.name, [])
        });
        const pending = session.importScene({});
        session.cancelImport();
        tasks[0].resolve({ name: 'late' });
        await expect(pending).rejects.toMatchObject({ name: 'ImportCancelledError' });
        expect(session.getState().scene).toBe(null);
        expect(session.getState().import.status).toBe('cancelled');
    });

    it('reports a synchronous task creation failure without losing the current scene', async () => {
        const session = new SceneSession({
            prepareTask: () => { throw new Error('Worker unavailable'); },
            createViews: () => candidate('unused', [])
        });
        await expect(session.importScene({})).rejects.toThrow('Worker unavailable');
        expect(session.getState().import).toMatchObject({ status: 'failed', message: 'Worker unavailable' });
        expect(session.getState().scene).toBe(null);
    });

    it('cannot restart after disposal', async () => {
        const session = new SceneSession({ prepareTask: deferredTask, createViews: () => candidate('unused', []) });
        session.dispose();
        await expect(session.importScene({})).rejects.toThrow('scene session has been disposed');
    });

    it('keeps a published replacement ready when old cleanup or a subscriber throws', async () => {
        const tasks = [];
        const session = new SceneSession({
            prepareTask: () => (tasks.push(deferredTask()), tasks.at(-1)),
            createViews: prepared => ({
                views: prepared.name,
                attach() {},
                dispose() { if (prepared.name === 'old') throw new Error('old cleanup failed'); }
            })
        });
        session.subscribe(() => { throw new Error('observer failed'); });
        const first = session.importScene({});
        tasks[0].resolve({ name: 'old' });
        await first;
        const second = session.importScene({});
        tasks[1].resolve({ name: 'new' });
        await second;
        expect(session.getState().scene.prepared.name).toBe('new');
        expect(session.getState().import.status).toBe('ready');
    });
});
