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

function allocationDevice() {
    const allocations = new Set();
    const device = {
        features: new Set(requiredFeatures), limits: { ...requiredLimits },
        createBuffer({ size }) {
            const buffer = { size, destroy: () => allocations.delete(buffer) };
            allocations.add(buffer);
            return buffer;
        },
        createShaderModule: descriptor => descriptor,
        createBindGroupLayout: descriptor => descriptor,
        createPipelineLayout: descriptor => descriptor,
        createComputePipeline: descriptor => descriptor,
        queue: { writeBuffer() {} },
        destroy() { throw new Error('Simulator must never destroy the host device'); }
    };
    return { device, allocations };
}

it('accepts a sufficient native device and releases every allocation after repeated empty simulations', async () => {
    const { device, allocations } = allocationDevice();
    for (let i = 0; i < 3; i++) {
        const sim = new Simulator(device, [], { min: [-1, -1, -1], max: [1, 1, 1] });
        expect(sim.stats().nodes).toBe(0);
        sim.step(1); sim.dispatch(1);
        expect(await sim.readPositions()).toEqual(new Float32Array());
        sim.destroy(); sim.destroy();
        expect(allocations.size).toBe(0);
    }
});

it('releases partial construction when a later scene-sized buffer exceeds the device limit', async () => {
    const { SoftBody } = await import('../../src/body/softBody.js');
    const { sphere } = await import('../../../../apps/simulator/src/assets/shapes.js');
    const { device, allocations } = allocationDevice();
    const body = new SoftBody({
        name: 'small sphere in large bounds', source: { kind: 'shape', shape: sphere({ radius: 0.04 }) }, elementSize: 0.02
    });
    expect(() => new Simulator(device, [body], { min: [-1, -1, -1], max: [1, 1, 1] }))
        .toThrow(/buffer requires .* device storage\/buffer limit/);
    expect(allocations.size).toBe(0);
});
