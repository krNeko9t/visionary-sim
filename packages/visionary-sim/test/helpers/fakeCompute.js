import { requiredFeatures, requiredLimits } from '../../src/sim/deviceRequirements.js';

export const fakeDevice = () => ({ features: new Set(requiredFeatures), limits: { ...requiredLimits } });

// In-memory implementation of the private compute boundary. These existing
// state/scene tests observe uploads and ownership, not GPU arithmetic. Native
// backend tests and browser gates separately exercise packing and dispatch.
export class ComputeBackend {
    constructor() { this.allocations = new Set(); }
    buffer(size) {
        const bytes = new Uint8Array(size);
        const allocations = this.allocations;
        const allocation = {
            bytes, writes: [], native: bytes,
            write(offset, data) {
                bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), offset);
                this.writes.push(bytes.slice());
            },
            async read(offset, size, target) {
                new Uint8Array(target.buffer, target.byteOffset, size).set(bytes.subarray(offset, offset + size));
            },
            destroy() { allocations.delete(allocation); }
        };
        allocations.add(allocation);
        return allocation;
    }
    kernel() { return { destroy() {} }; }
    pass() { return { set() {}, setupDispatch() {}, destroy() {} }; }
    dispatch() {}
    destroy() { for (const allocation of this.allocations) allocation.destroy(); }
}
