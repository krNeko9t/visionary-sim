import { describe, expect, it } from 'vitest';
import { Simulator } from '../../src/sim/simulator.js';
import { requiredFeatures, requiredLimits, validateDevice } from '../../src/sim/deviceRequirements.js';

describe('host device requirements', () => {
    const device = () => ({ features: new Set(requiredFeatures), limits: { ...requiredLimits } });
    it('accepts the required capabilities without creating or destroying the host device', () => {
        expect(() => validateDevice(device())).not.toThrow();
    });
    it('reports every missing feature and insufficient limit before allocation', () => {
        const host = device();
        host.limits.maxStorageBuffersPerShaderStage = 4;
        expect(() => validateDevice(host, {
            requiredFeatures: ['shader-f16'], requiredLimits
        })).toThrow(/shader-f16.*maxStorageBuffersPerShaderStage.*7.*4/s);
    });
});

it('the simulator checks capabilities before any GPU allocation', () => {
    let allocated = false;
    const device = {
        features: new Set(), limits: { ...requiredLimits, maxComputeWorkgroupSizeX: 32 },
        createBuffer() { allocated = true; throw new Error('too late'); }
    };
    expect(() => new Simulator(device, [], { min: [-1, -1, -1], max: [1, 1, 1] }))
        .toThrow(/maxComputeWorkgroupSizeX requires 64, device has 32/);
    expect(allocated).toBe(false);
});
