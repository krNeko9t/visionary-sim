/** @typedef {import('../compute/backend.js').ComputeBackend} ComputeBackend */
/** @typedef {ReturnType<ComputeBackend['kernel']>} Kernel */
/** @typedef {ReturnType<ComputeBackend['pass']>} Pass */

import { STATE_WGSL } from '../state/particles.js';
import driveWgsl from './wgsl/drive.wgsl?raw';
import driveCompliantWgsl from './wgsl/driveCompliant.wgsl?raw';
import driveHardWgsl from './wgsl/driveHard.wgsl?raw';

/**
 * The third kind of constraint: some nodes are not solved for, they are told.
 *
 * Elasticity and contact each discover what a node should do from the state
 * around it. This one is the opposite -- whoever is holding the nodes already
 * knows where each should go, and the only question left is how literally to
 * enforce that. Two answers to that question live here, chosen at runtime
 * rather than at construction, because the choice belongs to the holder, not
 * to the scene:
 *
 *   - `hard` zeroes the driven nodes' inverse mass, through
 *     `Particles.setPrescribed`, and moves them itself in a pass that stands
 *     in for both `predict` and `finalize` on exactly those nodes. Nothing
 *     else can move them.
 *   - `compliant` leaves their mass alone and only nudges position toward
 *     their goals by a fraction a response time controls -- see
 *     `wgsl/driveCompliant.wgsl` for the derivation. Elasticity, contact and
 *     the tank can all still move a compliant-held node.
 *
 * Which nodes are held and where the grab target is are two updates at two
 * different rates: the held set changes on a fresh hold, roughly once per
 * drag; the grab target changes every frame the pointer moves. `hold` and
 * `release` write the driven set and its buffer; `setGrabTarget` only ever
 * touches two uniforms, cheaply enough to call every frame.
 *
 * @typedef {'hard'|'compliant'} DriveLaw
 */

/** Threads per workgroup; must match `@workgroup_size` in both kernels. */
const WORKGROUP_SIZE = 64;

/**
 * Nodes this constraint can drive at once. Fixed rather than grown with the
 * held set, so a hold is one buffer write instead of a reallocation -- large
 * enough that `sim/grip.js`'s `withinRadius` range hold has room to grow into
 * without a second capacity decision. Exposed as {@link KinematicDrive#capacity}
 * for the one caller that has to decide which nodes to drop when a hold would
 * exceed it.
 */
const MAX_DRIVEN = 4096;

/** Driven record size in bytes, matching `struct Driven` in `wgsl/drive.wgsl`. */
const DRIVEN_STRIDE = 32;

/** Offsets into a driven record, in 4-byte words. */
const DRIVEN_FIELDS = {
    node: 0, //   u32
    offset: 4 //  vec4f
};

/**
 * How long the compliant law takes to close most of the way to a node's goal.
 * Small enough to read as "following" rather than "detached" -- see
 * `wgsl/driveCompliant.wgsl` for what the number means physically.
 */
const RESPONSE_TIME = 0.05;

export class KinematicDrive {
    /**
     * @param {ComputeBackend} backend - WebGPU backend.
     * @param {import('../state/particles.js').Particles} particles - Nodes to drive.
     */
    constructor(backend, particles) {
        this.backend = backend;
        this.particles = particles;
        this._law = 'hard';
        /** Global node indices currently held, so a law switch can re-apply prescription. */
        this.heldNodes = [];
        this.drivenCount = 0;

        this.driven = backend.buffer(MAX_DRIVEN * DRIVEN_STRIDE);

        // One staging copy sized to capacity, reused for every hold.
        this.drivenWords = new ArrayBuffer(MAX_DRIVEN * DRIVEN_STRIDE);
        this.drivenUints = new Uint32Array(this.drivenWords);
        this.drivenFloats = new Float32Array(this.drivenWords);

        this.shaders = {
            hard: this.kernel('sim-drive-hard', driveHardWgsl),
            compliant: this.kernel('sim-drive-compliant', driveCompliantWgsl)
        };

        const groups = Math.ceil(MAX_DRIVEN / WORKGROUP_SIZE);
        this.computes = {
            hard: this.pass('hard', groups),
            compliant: this.pass('compliant', groups)
        };
        for (const compute of Object.values(this.computes)) {
            compute.set('drivenCount', 0);
            compute.set('grabTarget', [0, 0, 0]);
            compute.set('grabTargetVelocity', [0, 0, 0]);
        }
        this.responseTime = RESPONSE_TIME;
    }

    /** Compliance response time in seconds; smaller means a stronger grip. */
    set responseTime(seconds) {
        if (!Number.isFinite(seconds) || seconds <= 0) {
            throw new RangeError('drive responseTime must be a finite positive number of seconds');
        }
        this._responseTime = seconds;
        for (const compute of Object.values(this.computes)) compute.set('responseTime', seconds);
    }

    get responseTime() { return this._responseTime; }

    /**
     * @param {string} name - Shader name, for debugging.
     * @param {string} body - Kernel source.
     * @returns {Kernel} The compiled kernel, with both sets of declarations.
     */
    kernel(name, body) {
        return this.backend.kernel(name, `${STATE_WGSL}\n${driveWgsl}\n${body}`);
    }

    /**
     * @param {DriveLaw} law - Which shader.
     * @param {number} groups - Workgroups to dispatch.
     * @returns {Pass} The configured dispatch.
     */
    pass(law, groups) {
        const compute = this.backend.pass(this.shaders[law], `sim-drive-${law}`);
        for (const [binding, buffer] of Object.entries(this.particles.bindings)) {
            compute.set(binding, buffer);
        }
        compute.set('driven', this.driven);
        compute.setupDispatch(groups, 1, 1);
        return compute;
    }

    /** @returns {number} Most nodes one hold can carry, see {@link MAX_DRIVEN}. */
    get capacity() {
        return MAX_DRIVEN;
    }

    /**
     * Starts driving a set of nodes from wherever they are now, releasing
     * whatever was held before.
     *
     * @param {number[]} nodes - Global node indices to hold.
     * @param {number[][]} offsets - Each node's offset from the anchor at this
     *   moment, which is where the grab target starts, `[x, y, z]`, same order
     *   as `nodes`.
     * @throws {Error} If a static node is included; the current hold is unchanged.
     */
    hold(nodes, offsets) {
        // Both kernels write positions directly, even for zero GPU mass.
        // Reject before any writes so a caller cannot override body ownership.
        if (nodes.some(node => this.particles.staticPrescribed.has(node))) {
            throw new Error('[drive] cannot hold a static prescribed node');
        }
        if (nodes.length === 0) {
            this.release();
            return;
        }

        const count = Math.min(nodes.length, MAX_DRIVEN);
        if (nodes.length > count) {
            console.warn(
                `[drive] asked to hold ${nodes.length} nodes, capacity is ${MAX_DRIVEN}; ` +
                `keeping the first ${count}.`
            );
        }

        const { drivenUints, drivenFloats } = this;
        const words = DRIVEN_STRIDE / 4;
        for (let i = 0; i < count; i++) {
            const base = i * words;
            drivenUints[base + DRIVEN_FIELDS.node] = nodes[i];
            drivenFloats[base + DRIVEN_FIELDS.offset] = offsets[i][0];
            drivenFloats[base + DRIVEN_FIELDS.offset + 1] = offsets[i][1];
            drivenFloats[base + DRIVEN_FIELDS.offset + 2] = offsets[i][2];
        }
        this.driven.write(0, new Uint8Array(this.drivenWords, 0, count * DRIVEN_STRIDE));

        this.drivenCount = count;
        this.heldNodes = nodes.slice(0, count);
        for (const compute of Object.values(this.computes)) {
            compute.set('drivenCount', count);
        }
        this.applyPrescription();
    }

    /**
     * @param {number[]} target - World position the grab target is at.
     * @param {number[]} velocity - The grab target's velocity this frame, world units per second.
     */
    setGrabTarget(target, velocity) {
        for (const compute of Object.values(this.computes)) {
            compute.set('grabTarget', target);
            compute.set('grabTargetVelocity', velocity);
        }
    }

    /** Stops driving every currently held node and returns its mass to it. */
    release() {
        this.drivenCount = 0;
        this.heldNodes = [];
        for (const compute of Object.values(this.computes)) {
            compute.set('drivenCount', 0);
        }
        this.particles.clearPrescribed();
    }

    /**
     * Switches the active drive law. Takes effect immediately, including on
     * whatever is currently held -- switching to compliant mid-hold hands the
     * held nodes their mass back, or elasticity and contact would go on
     * treating them as immovable.
     *
     * @param {DriveLaw} name - The law.
     */
    set law(name) {
        if (name !== 'hard' && name !== 'compliant') {
            throw new Error(`[drive] unknown law "${name}"`);
        }
        this._law = name;
        this.applyPrescription();
    }

    /** @returns {DriveLaw} The active law. */
    get law() {
        return this._law;
    }

    /**
     * Keeps `sim/state`'s prescribed set in sync with the law and the held
     * set. Only the hard law prescribes anything.
     */
    applyPrescription() {
        if (this.drivenCount > 0 && this._law === 'hard') {
            this.particles.setPrescribed(this.heldNodes);
        } else {
            this.particles.clearPrescribed();
        }
    }

    /**
     * The dispatch this constraint contributes to one substep, in order.
     *
     * @returns {Pass[]} The one pass for the active law, or none while
     *   nothing is held.
     */
    get passes() {
        return this.drivenCount > 0 ? [this.computes[this._law]] : [];
    }

    /**
     * @param {number} dt - Substep duration in seconds.
     */
    setSubstepDt(dt) {
        for (const compute of Object.values(this.computes)) {
            compute.set('dt', dt);
        }
    }

    destroy() {
        for (const compute of Object.values(this.computes)) {
            compute.destroy();
        }
        for (const shader of Object.values(this.shaders)) {
            shader.destroy();
        }
        this.driven.destroy();
    }
}
