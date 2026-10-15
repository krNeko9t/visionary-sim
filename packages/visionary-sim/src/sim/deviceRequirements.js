/** Native compute uses core WebGPU only; the host owns device negotiation. */
export const requiredFeatures = Object.freeze([]);
export const requiredLimits = Object.freeze({
    maxBindGroups: 1,
    maxBindingsPerBindGroup: 8,
    maxStorageBuffersPerShaderStage: 7,
    maxUniformBuffersPerShaderStage: 1,
    maxUniformBufferBindingSize: 64,
    // Fixed driven-node capacity (4096 records of 32 bytes). Scene-dependent
    // allocations and dispatch dimensions are checked during construction too.
    maxStorageBufferBindingSize: 131072,
    maxBufferSize: 131072,
    maxComputeWorkgroupsPerDimension: 64,
    maxComputeInvocationsPerWorkgroup: 64,
    maxComputeWorkgroupSizeX: 64
});

/** Check the actual device, not its adapter: requestDevice may grant less. */
export function validateDevice(device, requirements = { requiredFeatures, requiredLimits }) {
    const missing = requirements.requiredFeatures
        .filter(feature => !device.features?.has(feature))
        .map(feature => `feature ${feature} required`);
    for (const [limit, required] of Object.entries(requirements.requiredLimits)) {
        const actual = device.limits?.[limit];
        if (!(actual >= required)) missing.push(`${limit} requires ${required}, device has ${actual ?? 'missing'}`);
    }
    if (missing.length) throw new Error(`Simulator device requirements not met: ${missing.join('; ')}`);
}
