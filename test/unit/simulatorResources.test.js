import { beforeEach, describe, expect, it, vi } from 'vitest';

const gpu = vi.hoisted(() => ({
    allocations: 0, failAt: Infinity, operations: 0, failOperationAt: Infinity, resources: []
}));

vi.mock('playcanvas', () => {
    class Resource {
        constructor() {
            gpu.allocations++;
            if (gpu.allocations === gpu.failAt) {
                throw new Error(`injected GPU allocation failure ${gpu.failAt}`);
            }
            this.destroy = vi.fn();
            gpu.resources.push(this);
        }
        operation() {
            gpu.operations++;
            if (gpu.operations === gpu.failOperationAt) {
                throw new Error(`injected GPU setup failure ${gpu.failOperationAt}`);
            }
        }
    }
    class StorageBuffer extends Resource {
        write() { this.operation(); }
        async read() {}
    }
    class Shader extends Resource {}
    class Compute extends Resource {
        setParameter() { this.operation(); }
        setupDispatch() { this.operation(); }
    }
    return {
        BUFFERUSAGE_COPY_DST: 1,
        BUFFERUSAGE_COPY_SRC: 2,
        SHADERLANGUAGE_WGSL: 'wgsl',
        StorageBuffer,
        Shader,
        Compute
    };
});

import { Simulator } from '../../src/sim/simulator.js';

function preparedBody(name) {
    const restPositions = new Float32Array(8 * 3);
    let node = 0;
    for (let z = 0; z < 2; z++) {
        for (let y = 0; y < 2; y++) {
            for (let x = 0; x < 2; x++) {
                restPositions.set([x * 0.1, y * 0.1, z * 0.1], node++ * 3);
            }
        }
    }
    return {
        body: {
            name,
            material: {
                density: 1000,
                youngsModulus: 1e4,
                poissonRatio: 0.3,
                damping: 0.1,
                friction: 0.4,
                relaxation: 0.01
            }
        },
        lattice: {
            origin: [0, 0, 0],
            h: 0.1,
            cellDims: [1, 1, 1],
            nodeDims: [2, 2, 2],
            nodeCount: 8,
            restPositions,
            invMass: new Float32Array(8).fill(1),
            cells: Uint32Array.of(0),
            colorRanges: [
                { start: 0, count: 1 }, { start: 1, count: 0 },
                { start: 1, count: 0 }, { start: 1, count: 0 },
                { start: 1, count: 0 }, { start: 1, count: 0 },
                { start: 1, count: 0 }, { start: 1, count: 0 }
            ],
            mass: 1,
            volume: 0.001
        }
    };
}

const device = { supportsCompute: true, deviceType: 'webgpu', computeDispatch: vi.fn() };
const tank = { min: [-1, -1, -1], max: [1, 1, 1] };

beforeEach(() => {
    gpu.allocations = 0;
    gpu.failAt = Infinity;
    gpu.operations = 0;
    gpu.failOperationAt = Infinity;
    gpu.resources = [];
});

describe('Simulator construction owns every partial GPU allocation', () => {
    it('preserves migrated stable IDs and assigns opaque IDs to new prepared bodies', () => {
        const previous = { ...preparedBody('previous'), id: 'kept-body' };
        const added = preparedBody('added');
        const simulator = new Simulator(device, [previous, added], tank);

        expect(simulator.bodyIdAt(0)).toBe('kept-body');
        expect(simulator.bodyIdAt(1)).toMatch(/^simulation-body:/);
        expect(simulator.bodyIndexOf('kept-body')).toBe(0);
        expect(simulator.bodyIndexOf('missing')).toBe(-1);
        simulator.destroy();

        gpu.allocations = 0;
        gpu.resources = [];
        expect(() => new Simulator(device, [previous, { ...preparedBody('duplicate'), id: 'kept-body' }], tank))
            .toThrow(/IDs must be unique/);
        expect(gpu.allocations).toBe(0);
    });

    it('rolls back every completed allocation when any later allocation fails', () => {
        const bodies = [preparedBody('a'), preparedBody('b')];
        const complete = new Simulator(device, bodies, tank);
        const allocationCount = gpu.allocations;
        complete.destroy();
        complete.destroy();
        expect(gpu.resources.every(resource => resource.destroy.mock.calls.length === 1)).toBe(true);

        expect(allocationCount).toBeGreaterThan(20);
        for (let failAt = 1; failAt <= allocationCount; failAt++) {
            gpu.allocations = 0;
            gpu.failAt = failAt;
            gpu.operations = 0;
            gpu.failOperationAt = Infinity;
            gpu.resources = [];

            expect(() => new Simulator(device, bodies, tank)).toThrow(`injected GPU allocation failure ${failAt}`);
            expect(
                gpu.resources.every(resource => resource.destroy.mock.calls.length === 1),
                `allocation ${failAt} leaked or was destroyed twice`
            ).toBe(true);
        }
    });

    it('rolls back resources when setup fails after allocation', () => {
        const bodies = [preparedBody('a'), preparedBody('b')];
        const complete = new Simulator(device, bodies, tank);
        const operationCount = gpu.operations;
        complete.destroy();

        expect(operationCount).toBeGreaterThan(30);
        for (let failAt = 1; failAt <= operationCount; failAt++) {
            gpu.allocations = 0;
            gpu.failAt = Infinity;
            gpu.operations = 0;
            gpu.failOperationAt = failAt;
            gpu.resources = [];

            expect(() => new Simulator(device, bodies, tank)).toThrow(`injected GPU setup failure ${failAt}`);
            expect(
                gpu.resources.every(resource => resource.destroy.mock.calls.length === 1),
                `setup operation ${failAt} leaked or was destroyed twice`
            ).toBe(true);
        }
    });

    it('continues destroying GPU owners when grab release throws', () => {
        const simulator = new Simulator(device, [preparedBody('a')], tank);
        simulator.drive.release = () => { throw new Error('release failed'); };

        expect(() => simulator.destroy()).toThrow('release failed');
        expect(gpu.resources.every(resource => resource.destroy.mock.calls.length === 1)).toBe(true);
        expect(() => simulator.destroy()).not.toThrow();
    });
});
