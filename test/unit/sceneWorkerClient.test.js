import { describe, expect, it } from 'vitest';

import { createSceneImportTask, detectSceneImportCapabilities } from '../../src/app/import/workerClient.js';

class FakeWorker {
    static latest;
    constructor(url, options) {
        this.url = url;
        this.options = options;
        this.terminated = false;
        FakeWorker.latest = this;
    }
    postMessage(message) { this.message = message; }
    terminate() { this.terminated = true; }
}

class RejectingWorker extends FakeWorker {
    postMessage() { throw new Error('structured clone failed'); }
}

const files = {
    geometry: { name: 'scene.ply' },
    labels: { name: 'labels.npz' },
    physics: { name: 'physics.json' }
};

describe('scene import worker boundary', () => {
    it('terminates a cancelled worker and rejects the candidate immediately', async () => {
        const task = createSceneImportTask(files, () => {}, { WorkerClass: FakeWorker, workerUrl: '/worker.js' });
        task.cancel();
        await expect(task.promise).rejects.toMatchObject({ name: 'ImportCancelledError' });
        expect(FakeWorker.latest.terminated).toBe(true);
    });

    it('reports missing runtime capabilities from actual APIs and device state', () => {
        expect(detectSceneImportCapabilities({ graphicsDevice: { isWebGPU: false }, environment: {} })).toEqual({
            available: false,
            missing: ['Web Worker', 'File/Blob', 'deflate-raw decompression', 'WebGPU device']
        });
    });

    it('terminates the worker when posting the selected files fails synchronously', () => {
        expect(() => createSceneImportTask(files, () => {}, {
            WorkerClass: RejectingWorker,
            workerUrl: '/worker.js'
        })).toThrow('structured clone failed');
        expect(FakeWorker.latest.terminated).toBe(true);
    });
});
