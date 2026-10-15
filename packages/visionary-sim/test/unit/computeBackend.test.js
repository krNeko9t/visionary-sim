import { expect, it } from 'vitest';
import { ComputeBackend } from '../../src/sim/compute/backend.js';

it('rejects unknown parameters and packs a scalar after vec3 without moving it into padding', () => {
    const buffers = [];
    const device = {
        limits: { maxBufferSize: 1024, maxStorageBufferBindingSize: 1024 },
        createBuffer: descriptor => { const b = { ...descriptor, destroy() {} }; buffers.push(b); return b; },
        createShaderModule: descriptor => descriptor,
        createBindGroupLayout: descriptor => descriptor,
        createPipelineLayout: descriptor => descriptor,
        createComputePipeline: descriptor => descriptor,
        queue: { writeBuffer(buffer, offset, data) { buffer.bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice(); } }
    };
    const backend = new ComputeBackend(device);
    const kernel = backend.kernel('packing', `
        struct Params { direction: vec3f, count: u32, dt: f32, }
        @group(0) @binding(7) var<uniform> params: Params;
        @compute @workgroup_size(64) fn main() {}
    `);
    const pass = backend.pass(kernel, 'packing');
    expect(() => pass.set('dtt', 1)).toThrow(/packing.*dtt/);
    pass.set('direction', [1, 2, 3]);
    pass.set('count', 9);
    pass.set('dt', 0.25);
    pass.upload();
    const bytes = new DataView(buffers[0].bytes.buffer);
    expect([0, 4, 8].map(n => bytes.getFloat32(n, true))).toEqual([1, 2, 3]);
    expect(bytes.getUint32(12, true)).toBe(9);
    expect(bytes.getFloat32(16, true)).toBe(0.25);
    expect(buffers[0].size).toBe(32);
});

// A tiny fake GPU executes this fixture's published operation from the bound
// bytes. It deliberately knows the literal slots/offsets from the shader, not
// the backend's schema, so swapped bindings or bad packing change the result.
function arithmeticDevice() {
    const buffers = new Set();
    const commands = [];
    const device = {
        limits: { maxBufferSize: 4096, maxStorageBufferBindingSize: 4096, maxComputeWorkgroupsPerDimension: 100 },
        createBuffer({ size }) {
            const buffer = {
                bytes: new Uint8Array(size),
                async mapAsync() {}, unmap() {},
                getMappedRange() { return this.bytes.buffer; },
                destroy() { buffers.delete(buffer); }
            };
            buffers.add(buffer);
            return buffer;
        },
        createShaderModule: descriptor => descriptor,
        createBindGroupLayout: descriptor => descriptor,
        createPipelineLayout: descriptor => descriptor,
        createComputePipeline(descriptor) {
            expect(descriptor.layout.bindGroupLayouts[0].entries).toEqual([
                { binding: 0, visibility: 4, buffer: { type: 'read-only-storage' } },
                { binding: 3, visibility: 4, buffer: { type: 'storage' } },
                { binding: 7, visibility: 4, buffer: { type: 'uniform', minBindingSize: 16 } }
            ]);
            return descriptor;
        },
        createBindGroup: descriptor => descriptor,
        createCommandEncoder() {
            const ops = [];
            return {
                beginComputePass() {
                    let group;
                    return {
                        setPipeline() {}, setBindGroup(_, value) { group = value; }, end() {},
                        dispatchWorkgroups(x, y, z) {
                            const bound = Object.fromEntries(group.entries.map(e => [e.binding, e.resource.buffer]));
                            ops.push(() => {
                                const input = new Float32Array(bound[0].bytes.buffer);
                                const output = new Float32Array(bound[3].bytes.buffer);
                                const params = new DataView(bound[7].bytes.buffer);
                                for (let i = 0; i < x * y * z * 64 && i < params.getUint32(4, true); i++) {
                                    output[i] = input[i] * params.getFloat32(0, true) + 3;
                                }
                            });
                        }
                    };
                },
                copyBufferToBuffer(src, start, dest, offset, size) {
                    ops.push(() => dest.bytes.set(src.bytes.subarray(start, start + size), offset));
                },
                finish() { return ops; }
            };
        },
        queue: {
            writeBuffer(buffer, offset, data) { buffer.bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), offset); },
            submit(batches) { for (const batch of batches) for (const op of batch) { commands.push(op); op(); } }
        }
    };
    return { device, buffers, commands };
}
const arithmetic = `
    struct Params { factor: f32, count: u32, }
    @group(0) @binding(0) var<storage, read> input: array<f32>;
    @group(0) @binding(3) var<storage, read_write> output: array<f32>;
    @group(0) @binding(7) var<uniform> params: Params;
    @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
        if (id.x < params.count) { output[id.x] = input[id.x] * params.factor + 3.0; }
    }
`;

it('submits the specified range with the correct buffers, then reads exactly that result outside a frame', async () => {
    const { device, buffers } = arithmeticDevice();
    const backend = new ComputeBackend(device);
    const input = backend.buffer(65 * 4), output = backend.buffer(65 * 4);
    input.write(0, Float32Array.from({ length: 65 }, (_, i) => i));
    const pass = backend.pass(backend.kernel('arithmetic', arithmetic), 'arithmetic');
    pass.set('input', input); pass.set('output', output);
    pass.set('factor', 2); pass.set('count', 65);
    pass.setupDispatch(2);
    backend.dispatch([pass], 'standalone');
    const result = new Float32Array(3);
    await output.read(62 * 4, result.byteLength, result);
    expect([...result]).toEqual([127, 129, 131]);
    // A second submission must see changed uniforms, not stale cached bytes.
    pass.set('factor', -1);
    backend.dispatch([pass], 'standalone');
    await output.read(62 * 4, result.byteLength, result);
    expect([...result]).toEqual([-59, -60, -61]);
    expect(buffers.size).toBe(3); // No mapped staging allocation survives reads.
    backend.destroy(); backend.destroy();
    expect(buffers.size).toBe(0);
});

it('rejects missing bindings, cross-device buffers and invalid dispatch sizes', () => {
    const { device } = arithmeticDevice();
    const backend = new ComputeBackend(device);
    const pass = backend.pass(backend.kernel('arithmetic', arithmetic), 'arithmetic');
    pass.set('factor', 2); pass.set('count', 1);
    expect(() => backend.dispatch([pass])).toThrow(/invalid buffer input/);
    pass.set('input', new ComputeBackend(device).buffer(4));
    pass.set('output', backend.buffer(4));
    expect(() => backend.dispatch([pass])).toThrow(/invalid buffer input/);
    expect(() => pass.setupDispatch(101)).toThrow(/invalid dispatch.*device limit is 100/);
    backend.destroy();
});

it('frees staging memory when mapping fails', async () => {
    const { device, buffers } = arithmeticDevice();
    const original = device.createBuffer;
    device.createBuffer = descriptor => {
        const buffer = original(descriptor);
        if (descriptor.usage & 1) buffer.mapAsync = async () => { throw new Error('mapping failed'); };
        return buffer;
    };
    const backend = new ComputeBackend(device);
    const input = backend.buffer(16);
    await expect(input.read(0, 16, new Float32Array(4))).rejects.toThrow('mapping failed');
    expect(buffers.size).toBe(1);
    backend.destroy();
    expect(buffers.size).toBe(0);
});
