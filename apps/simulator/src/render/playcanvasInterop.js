import { WORKBUFFER_UPDATE_ALWAYS } from 'playcanvas';

/**
 * The only application dependency on PlayCanvas's private WebGPU representation.
 * Borrow the host's device; neither this module nor visionary-sim owns it.
 * @param {import('playcanvas').GraphicsDevice} graphicsDevice - Existing host device.
 * @returns {GPUDevice} The native device, never a separately requested device.
 */
export function nativeDevice(graphicsDevice) {
    if (!graphicsDevice.isWebGPU || !graphicsDevice.wgpu) {
        throw new Error('PlayCanvas native-buffer interop requires its WebGPU device');
    }
    return graphicsDevice.wgpu;
}

/**
 * Occupies a component's work-buffer modifier until detached. The caller supplies
 * PlayCanvas WGSL declarations and read-only native storage buffers. This is not
 * the final deformation manifest API. Buffers must belong to nativeDevice(host).
 *
 * Write/submit native work in app.update, before the host evaluates its work
 * buffer. Both use the same queue. Detach before destroying caller-owned buffers
 * or the host component; no device or buffer is destroyed here.
 * @param {import('playcanvas').GSplatComponent} component - Hook to occupy.
 * @param {string} wgsl - Host modifier code, including storage declarations.
 * @param {Record<string, GPUBuffer>} buffers - Parameter names to borrowed buffers.
 * @returns {() => void} Idempotent detach, restoring the previous update mode.
 */
export function attachNativeSplatModifier(component, wgsl, buffers) {
    const update = component.workBufferUpdate;
    component.setWorkBufferModifier({ wgsl });
    component.workBufferUpdate = WORKBUFFER_UPDATE_ALWAYS;
    for (const [name, buffer] of Object.entries(buffers)) {
        component.setParameter(name, { impl: { buffer } });
    }
    let attached = true;
    return () => {
        if (!attached) return;
        attached = false;
        component.setWorkBufferModifier(null);
        for (const name of Object.keys(buffers)) component.deleteParameter(name);
        component.workBufferUpdate = update;
    };
}
