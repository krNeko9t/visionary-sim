function aborted() {
    const error = new Error('GPU candidate preparation was cancelled');
    error.name = 'AbortError';
    return error;
}

function gpuError(kind, error) {
    return new Error(`GPU ${kind} error: ${error.message ?? String(error)}`);
}

/**
 * Keeps WebGPU validation scopes open across asynchronous candidate creation.
 * `validate` must submit the candidate's real binding/dispatch work from a
 * legal frame; queue completion and both scope results gate publication.
 */
const deviceScopes = new WeakMap();

export function createGpuCandidate(options) {
    const device = options.graphicsDevice?.wgpu;
    if (!device) return prepareGpuCandidate(options);
    // Error scopes form a native-device stack, not a per-candidate stack.
    // Another asynchronous candidate must not pop the first one's scopes.
    const previous = deviceScopes.get(device);
    const operation = previous
        ? previous.then(() => prepareGpuCandidate(options))
        : prepareGpuCandidate(options);
    const settled = operation.then(() => {}, () => {});
    deviceScopes.set(device, settled);
    settled.then(() => {
        if (deviceScopes.get(device) === settled) deviceScopes.delete(device);
    });
    return operation;
}

async function prepareGpuCandidate({ graphicsDevice, signal, create, validate }) {
    const wgpu = graphicsDevice?.wgpu;
    if (!wgpu?.pushErrorScope || !wgpu?.popErrorScope) {
        throw new Error('GPU candidate validation requires a WebGPU graphics device');
    }
    if (signal?.aborted) throw aborted();

    const scopes = [];
    let candidate = null;
    let failure = null;
    const scopeErrors = [];
    try {
        wgpu.pushErrorScope('out-of-memory');
        scopes.push('out-of-memory');
        wgpu.pushErrorScope('validation');
        scopes.push('validation');

        if (signal?.aborted) throw aborted();
        candidate = await create();
        if (signal?.aborted) throw aborted();
        await validate(candidate);
        await wgpu.queue?.onSubmittedWorkDone?.();
        if (signal?.aborted) throw aborted();
    } catch (error) {
        failure = error;
    } finally {
        while (scopes.length > 0) {
            const kind = scopes.pop();
            try {
                const error = await wgpu.popErrorScope();
                if (error) scopeErrors.push(gpuError(kind, error));
            } catch (error) {
                scopeErrors.push(new Error(`GPU error scope could not close: ${error.message ?? String(error)}`));
            }
        }
    }

    failure ??= scopeErrors[0] ?? (signal?.aborted ? aborted() : null);
    if (failure) {
        try {
            if (typeof candidate?.dispose === 'function') await candidate.dispose();
            else await candidate?.destroy?.();
        } catch {}
        throw failure;
    }
    return candidate;
}
