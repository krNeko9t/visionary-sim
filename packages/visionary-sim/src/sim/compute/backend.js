// Private compute boundary. The deliberately small schema reader accepts only
// the scalar/vector Params structs used by our kernels, not arbitrary WGSL.
// Binding numbers and field order come from the explicit shader declarations.
const roundUp = (n, alignment) => Math.ceil(n / alignment) * alignment;
const TYPES = {
    f32: [4, 1, 'setFloat32'], u32: [4, 1, 'setUint32'],
    vec3f: [16, 3, 'setFloat32'], vec3u: [16, 3, 'setUint32']
};

function schema(source) {
    const code = source.replace(/\/\/[^\n]*/g, '');
    const fields = new Map();
    let size = 0;
    const body = code.match(/struct Params\s*\{([^}]*)\}/)?.[1];
    if (!body) throw new Error('Compute kernel needs an explicit Params struct');
    for (const declaration of body.split(',').map(s => s.trim()).filter(Boolean)) {
        const [name, type] = declaration.split(':').map(s => s.trim());
        if (!TYPES[type] || fields.has(name)) throw new Error(`Unsupported compute parameter: ${declaration}`);
        const [alignment, length, setter] = TYPES[type];
        size = roundUp(size, alignment);
        fields.set(name, { offset: size, length, setter });
        size += length * 4;
    }
    const bindings = [...code.matchAll(/@group\(0\)\s*@binding\((\d+)\)\s*var<storage,\s*(read|read_write)>\s*(\w+):/g)]
        .map(([, slot, access, name]) => ({ binding: Number(slot), name, type: access === 'read' ? 'read-only-storage' : 'storage' }));
    if (!/@group\(0\)\s*@binding\(7\)\s*var<uniform>\s*params:\s*Params;/.test(code)) {
        throw new Error('Compute Params must use group 0 binding 7');
    }
    return { fields, bindings, size: roundUp(size, 16) };
}

class Allocation {
    constructor(backend, size, usage) {
        this.backend = backend;
        this.size = size;
        this.native = backend.device.createBuffer({ size: Math.max(4, roundUp(size, 4)), usage });
        backend.allocations.add(this);
    }
    write(offset, data) {
        if (data.byteLength) this.backend.device.queue.writeBuffer(this.native, offset, data);
    }
    async read(offset, size, target) {
        if (!size) return target;
        const { device } = this.backend;
        const staging = new Allocation(this.backend, size, 1 | 8); // MAP_READ | COPY_DST
        try {
            const encoder = device.createCommandEncoder({ label: 'sim-readback' });
            encoder.copyBufferToBuffer(this.native, offset, staging.native, 0, size);
            device.queue.submit([encoder.finish()]);
            await staging.native.mapAsync(1); // GPUMapMode.READ
            new Uint8Array(target.buffer, target.byteOffset, size).set(new Uint8Array(staging.native.getMappedRange()));
            staging.native.unmap();
            return target;
        } finally {
            staging.destroy();
        }
    }
    destroy() {
        if (!this.backend.allocations.delete(this)) return;
        this.native.destroy();
    }
}

class Pass {
    constructor(backend, kernel, name) {
        this.backend = backend;
        this.kernel = kernel;
        this.name = name;
        this.values = new Map();
        this.groups = [1, 1, 1];
        this.words = new ArrayBuffer(kernel.size);
        this.uniforms = new Allocation(backend, kernel.size, 64 | 8); // UNIFORM | COPY_DST
    }
    set(name, value) {
        if (!this.kernel.fields.has(name) && !this.kernel.bindings.some(b => b.name === name)) {
            throw new Error(`${this.name}: unknown parameter ${name}`);
        }
        if (this.values.get(name) !== value && !this.kernel.fields.has(name)) this.group = null;
        this.values.set(name, value);
    }
    setupDispatch(x, y = 1, z = 1) {
        const limit = this.backend.device.limits.maxComputeWorkgroupsPerDimension;
        if ([x, y, z].some(n => !Number.isInteger(n) || n < 0 || n > limit)) {
            throw new Error(`${this.name}: invalid dispatch ${[x, y, z]}; device limit is ${limit}`);
        }
        this.groups = [x, y, z];
    }
    upload() {
        const view = new DataView(this.words);
        for (const [name, field] of this.kernel.fields) {
            const value = this.values.get(name);
            if (value === undefined) throw new Error(`${this.name}: missing parameter ${name}`);
            const values = field.length === 1 ? [value] : value;
            if (values.length !== field.length) throw new Error(`${this.name}: invalid parameter ${name}`);
            for (let i = 0; i < field.length; i++) view[field.setter](field.offset + i * 4, values[i], true);
        }
        this.uniforms.write(0, new Uint8Array(this.words));
    }
    bindGroup() {
        this.group ??= this.backend.device.createBindGroup({
            label: this.name,
            layout: this.kernel.layout,
            entries: [...this.kernel.bindings.map(({ binding, name }) => {
                const buffer = this.values.get(name);
                if (!(buffer instanceof Allocation) || buffer.backend !== this.backend) throw new Error(`${this.name}: invalid buffer ${name}`);
                return { binding, resource: { buffer: buffer.native } };
            }), { binding: 7, resource: { buffer: this.uniforms.native } }]
        });
        return this.group;
    }
    destroy() { this.uniforms.destroy(); this.group = null; this.values.clear(); }
}

export class ComputeBackend {
    constructor(device) { this.device = device; this.allocations = new Set(); this.destroyed = false; }
    buffer(size) {
        if (this.destroyed) throw new Error('Compute backend is destroyed');
        const limit = Math.min(this.device.limits.maxBufferSize, this.device.limits.maxStorageBufferBindingSize);
        if (!Number.isSafeInteger(size) || size < 0 || Math.max(4, roundUp(size, 4)) > limit) {
            throw new Error(`Simulation buffer requires ${size} bytes; device storage/buffer limit is ${limit}`);
        }
        return new Allocation(this, size, 128 | 8 | 4); // STORAGE | COPY_DST | COPY_SRC
    }
    kernel(name, source) {
        const description = schema(source);
        const layout = this.device.createBindGroupLayout({ label: name, entries: [
            ...description.bindings.map(({ binding, type }) => ({ binding, visibility: 4, buffer: { type } })),
            { binding: 7, visibility: 4, buffer: { type: 'uniform', minBindingSize: description.size } }
        ] });
        const pipeline = this.device.createComputePipeline({
            label: name,
            layout: this.device.createPipelineLayout({ bindGroupLayouts: [layout] }),
            compute: { module: this.device.createShaderModule({ label: name, code: source }), entryPoint: 'main' }
        });
        return { ...description, layout, pipeline, destroy() { this.pipeline = null; this.layout = null; } };
    }
    pass(kernel, name) { return new Pass(this, kernel, name); }
    dispatch(sequence, label) {
        // A pass's uniforms are stable across repeated substeps; each colour
        // has its own pass. Upload once before recording the ordered dispatches.
        if (this.destroyed) throw new Error('Compute backend is destroyed');
        for (const pass of new Set(sequence)) {
            if (pass.groups.some(n => !Number.isInteger(n) || n < 1 || n > this.device.limits.maxComputeWorkgroupsPerDimension)) {
                throw new Error(`${pass.name}: invalid dispatch ${pass.groups}`);
            }
            pass.bindGroup();
            pass.upload();
        }
        const encoder = this.device.createCommandEncoder({ label });
        const compute = encoder.beginComputePass({ label });
        for (const pass of sequence) {
            compute.setPipeline(pass.kernel.pipeline);
            compute.setBindGroup(0, pass.bindGroup());
            compute.dispatchWorkgroups(...pass.groups);
        }
        compute.end();
        this.device.queue.submit([encoder.finish()]);
    }
    destroy() {
        this.destroyed = true;
        for (const allocation of this.allocations) allocation.destroy();
    }
}
