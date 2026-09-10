import { describe, expect, it, vi } from 'vitest';

import { createGpuCandidate } from '../../src/app/gpuCandidate.js';

function fixture(popResults = [null, null]) {
    const pops = [...popResults];
    const wgpu = {
        pushErrorScope: vi.fn(),
        popErrorScope: vi.fn(async () => pops.shift() ?? null),
        queue: { onSubmittedWorkDone: vi.fn(async () => {}) }
    };
    return { graphicsDevice: { wgpu }, wgpu };
}

describe('GPU candidate validation', () => {
    it('closes the remaining scope even when the first pop rejects', async () => {
        const { graphicsDevice, wgpu } = fixture();
        wgpu.popErrorScope.mockRejectedValueOnce(new Error('device lost'));
        const candidate = { dispose: vi.fn() };
        await expect(createGpuCandidate({ graphicsDevice, create: () => candidate, validate() {} }))
            .rejects.toThrow('device lost');
        expect(wgpu.popErrorScope).toHaveBeenCalledTimes(2);
        expect(candidate.dispose).toHaveBeenCalledOnce();
    });
    it('serializes source and simulation scopes on the same native device', async () => {
        const { graphicsDevice, wgpu } = fixture();
        let finish;
        const gate = new Promise(resolve => { finish = resolve; });
        const first = createGpuCandidate({ graphicsDevice, create: () => ({}), validate: () => gate });
        const secondCreate = vi.fn(() => ({}));
        const second = createGpuCandidate({ graphicsDevice, create: secondCreate, validate() {} });
        await Promise.resolve();
        expect(secondCreate).not.toHaveBeenCalled();
        expect(wgpu.pushErrorScope).toHaveBeenCalledTimes(2);
        finish();
        await Promise.all([first, second]);
        expect(wgpu.popErrorScope).toHaveBeenCalledTimes(4);
    });
    it('publishes only after validation work completes and both scopes close', async () => {
        const { graphicsDevice, wgpu } = fixture();
        const candidate = { destroy: vi.fn() };
        const validate = vi.fn(async value => expect(value).toBe(candidate));

        await expect(createGpuCandidate({
            graphicsDevice,
            create: () => candidate,
            validate
        })).resolves.toBe(candidate);

        expect(wgpu.pushErrorScope.mock.calls).toEqual([['out-of-memory'], ['validation']]);
        expect(validate).toHaveBeenCalledOnce();
        expect(wgpu.queue.onSubmittedWorkDone).toHaveBeenCalledOnce();
        expect(wgpu.popErrorScope).toHaveBeenCalledTimes(2);
        expect(candidate.destroy).not.toHaveBeenCalled();
    });

    it('destroys a candidate when a scoped GPU validation error arrives asynchronously', async () => {
        const { graphicsDevice, wgpu } = fixture([{ message: 'bad bind group' }, null]);
        const candidate = { destroy: vi.fn() };

        await expect(createGpuCandidate({
            graphicsDevice,
            create: () => candidate,
            validate: async () => {}
        })).rejects.toThrow(/validation.*bad bind group/i);

        expect(wgpu.popErrorScope).toHaveBeenCalledTimes(2);
        expect(candidate.destroy).toHaveBeenCalledOnce();
    });

    it('closes both scopes and destroys late work when cancelled during validation', async () => {
        const { graphicsDevice, wgpu } = fixture();
        const controller = new AbortController();
        const candidate = { destroy: vi.fn() };

        await expect(createGpuCandidate({
            graphicsDevice,
            signal: controller.signal,
            create: () => candidate,
            validate: async () => controller.abort()
        })).rejects.toMatchObject({ name: 'AbortError' });

        expect(wgpu.popErrorScope).toHaveBeenCalledTimes(2);
        expect(candidate.destroy).toHaveBeenCalledOnce();
    });

    it('still closes every pushed scope when synchronous construction throws', async () => {
        const { graphicsDevice, wgpu } = fixture();

        await expect(createGpuCandidate({
            graphicsDevice,
            create: () => { throw new Error('construction failed'); },
            validate: async () => {}
        })).rejects.toThrow('construction failed');

        expect(wgpu.popErrorScope).toHaveBeenCalledTimes(2);
    });
});
