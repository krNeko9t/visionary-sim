import { BUFFERUSAGE_COPY_DST, BUFFERUSAGE_COPY_SRC, StorageBuffer } from 'playcanvas';

import stateWgsl from './state.wgsl?raw';

/**
 * Every degree of freedom in the scene, and nothing that explains where they
 * came from.
 *
 * A node here is a point with a position, a history and an inverse mass. It is
 * not a lattice corner: this file never learns that cells exist, how they are
 * coloured, or which of them share it. That ignorance is the point. Whatever
 * wants to move these nodes -- the elastic constraint that does know about
 * cells, a contact constraint that will not -- reads and writes them through
 * the same four buffers and the same declarations.
 *
 * Bodies are concatenated into one set of buffers rather than given their own,
 * for two reasons that survive any constraint type: the number of dispatches
 * stays independent of the number of bodies, and one dispatch can cover work
 * that spans several of them.
 *
 * Nothing here is read back per frame. The one readback this file offers
 * returns every position at once; whatever calls it decides how rarely that
 * is worth doing.
 *
 * @typedef {object} BodyNodes
 * @property {Float32Array} restPositions - Rest positions, 3 floats per node.
 * @property {Float32Array} invMass - Inverse mass per node, 0 where inert.
 * @property {number} nodeCount - Nodes in this body, including inert ones.
 */

/** The particle half of every kernel's declarations. See `state.wgsl`. */
export const STATE_WGSL = stateWgsl;

/** NodeParams size in bytes, matching the struct in `state.wgsl`. */
const PARAMS_STRIDE = 32;

/** Offsets into NodeParams, in 4-byte words. */
const PARAMS_FIELDS = {
    nodeOffset: 0, // u32
    nodeCount: 1, //  u32
    damping: 2, //    f32
    friction: 3 //    f32
};

const PARAMS_WORDS = PARAMS_STRIDE / 4;

export class Particles {
    /**
     * @param {import('playcanvas').GraphicsDevice} device - WebGPU device.
     * @param {BodyNodes[]} bodies - Each body's nodes, in scene order.
     */
    constructor(device, bodies) {
        this.device = device;
        this.bodies = bodies;

        let total = 0;
        /** Where each body's nodes start in the shared arrays. */
        this.offsets = bodies.map(({ nodeCount }) => {
            const offset = total;
            total += nodeCount;
            return offset;
        });
        this.nodeCount = total;

        const positions = new Float32Array(total * 4);
        /** Kept on the CPU as well: picking needs to know which nodes are inert. */
        const invMass = new Float32Array(total);
        for (let b = 0; b < bodies.length; b++) {
            const { restPositions, nodeCount } = bodies[b];
            const offset = this.offsets[b];
            for (let n = 0; n < nodeCount; n++) {
                positions[(offset + n) * 4] = restPositions[n * 3];
                positions[(offset + n) * 4 + 1] = restPositions[n * 3 + 1];
                positions[(offset + n) * 4 + 2] = restPositions[n * 3 + 2];
            }
            invMass.set(bodies[b].invMass, offset);
        }
        this.restPositions = positions;
        this.invMass = invMass;

        // Which nodes currently read as inert on the GPU whatever their
        // material inverse mass says. Kept apart from `invMass` itself so
        // that whatever asked for it -- a constraint driving those nodes some
        // other way -- can be undone without forgetting what they actually
        // weigh.
        this.prescribed = new Set();
        /** GPU-facing copy of `invMass`, with prescribed nodes forced to zero. */
        this.gpuInvMass = new Float32Array(invMass);

        const usage = BUFFERUSAGE_COPY_DST | BUFFERUSAGE_COPY_SRC;
        this.nodePos = new StorageBuffer(device, positions.byteLength, usage);
        this.nodePrev = new StorageBuffer(device, positions.byteLength, usage);
        this.nodeVel = new StorageBuffer(device, positions.byteLength, usage);
        this.nodeInvMass = new StorageBuffer(device, invMass.byteLength, usage);
        this.nodeParams = new StorageBuffer(device, bodies.length * PARAMS_STRIDE, usage);

        this.nodePos.write(0, positions);
        this.nodePrev.write(0, positions);
        this.nodeVel.write(0, new Float32Array(total * 4));
        this.nodeInvMass.write(0, this.gpuInvMass);

        // One staging copy reused for every parameter update, so a material
        // change does not allocate.
        this.paramWords = new ArrayBuffer(bodies.length * PARAMS_STRIDE);
        this.paramFloats = new Float32Array(this.paramWords);
        this.paramUints = new Uint32Array(this.paramWords);

        /** Per-body values the node passes read; set through {@link setParams}. */
        this.params = bodies.map(() => ({ damping: 0, friction: 0 }));
        this.uploadParams();
    }

    /**
     * @param {number} bodyIndex - Index into the body list.
     * @returns {number} Where that body's nodes start in the shared arrays.
     */
    offsetOf(bodyIndex) {
        return this.offsets[bodyIndex];
    }

    /**
     * Sets the parameters the node-level passes read for one body.
     *
     * @param {number} bodyIndex - Index into the body list.
     * @param {{ damping?: number, friction?: number }} values - Fields to change.
     */
    setParams(bodyIndex, values) {
        Object.assign(this.params[bodyIndex], values);
        this.uploadParams();
    }

    /** Rewrites the per-body node parameter buffer. */
    uploadParams() {
        const { paramFloats, paramUints } = this;

        for (let b = 0; b < this.bodies.length; b++) {
            const base = b * PARAMS_WORDS;
            const { damping, friction } = this.params[b];

            paramUints[base + PARAMS_FIELDS.nodeOffset] = this.offsets[b];
            paramUints[base + PARAMS_FIELDS.nodeCount] = this.bodies[b].nodeCount;
            paramFloats[base + PARAMS_FIELDS.damping] = damping;
            paramFloats[base + PARAMS_FIELDS.friction] = friction;
        }

        this.nodeParams.write(0, new Uint8Array(this.paramWords));
    }

    /**
     * Forces a set of nodes' inverse mass to read as zero on the GPU, whatever
     * their material says.
     *
     * This is the one thing `sim/state` knows how to do for a constraint that
     * wants to drive some nodes itself: it does not learn why, or who is
     * asking, or what "prescribed" means to the caller. Replaces whatever set
     * was prescribed before -- there is one driver at a time.
     *
     * @param {number[]} nodes - Global node indices to prescribe.
     */
    setPrescribed(nodes) {
        this.prescribed = new Set(nodes);
        this.uploadGpuMasses();
    }

    /** Releases every prescribed node back to its material inverse mass. */
    clearPrescribed() {
        this.prescribed = new Set();
        this.uploadGpuMasses();
    }

    /**
     * Re-reads the inverse masses from the sources this was built from.
     *
     * Whoever owns those arrays may rewrite them in place -- a density change
     * does exactly that -- and this is how the GPU is told. What made the
     * numbers change is not this file's business.
     */
    uploadMasses() {
        for (let b = 0; b < this.bodies.length; b++) {
            this.invMass.set(this.bodies[b].invMass, this.offsets[b]);
        }
        this.uploadGpuMasses();
    }

    /**
     * Rewrites the GPU inverse-mass buffer from the material truth, with
     * every currently prescribed node forced back to zero.
     *
     * A density change and a constraint newly prescribing this set are
     * independent events that both touch this buffer; routing both through
     * here is what keeps a mass update from reviving a node a constraint is
     * currently driving.
     */
    uploadGpuMasses() {
        this.gpuInvMass.set(this.invMass);
        for (const node of this.prescribed) {
            this.gpuInvMass[node] = 0;
        }
        this.nodeInvMass.write(0, this.gpuInvMass);
    }

    /**
     * Copies the live node positions back to the CPU.
     *
     * The only readback in the system. Anything that wanted this per frame
     * would be asking the CPU to wait for the GPU, which is the one thing
     * these buffers are arranged to avoid -- so this is meant to be called
     * rarely, not every frame.
     *
     * @returns {Promise<Float32Array>} Positions, 4 floats per node. Reused
     *   between calls, so read it before awaiting anything else.
     */
    async readPositions() {
        this.readback ??= new Float32Array(this.nodeCount * 4);
        await this.nodePos.read(0, this.readback.byteLength, this.readback, true);
        return this.readback;
    }

    /** Every buffer this owns, keyed by its name in the WGSL. */
    get bindings() {
        return {
            nodePos: this.nodePos,
            nodePrev: this.nodePrev,
            nodeVel: this.nodeVel,
            nodeInvMass: this.nodeInvMass,
            nodeParams: this.nodeParams
        };
    }

    /** Restores every node to its rest position, at rest. */
    reset() {
        this.nodePos.write(0, this.restPositions);
        this.nodePrev.write(0, this.restPositions);
        this.nodeVel.write(0, new Float32Array(this.nodeCount * 4));
    }

    destroy() {
        for (const buffer of Object.values(this.bindings)) {
            buffer.destroy();
        }
    }
}
