import {
    BUFFERUSAGE_COPY_DST,
    BUFFERUSAGE_COPY_SRC,
    Compute,
    SHADERLANGUAGE_WGSL,
    Shader,
    StorageBuffer
} from 'playcanvas';

import { STATE_WGSL } from '../state/particles.js';
import { broadphaseGrid, worstCaseBucketOccupancy } from './broadphase.js';
import { surfaceNodes } from '../discretize/lattice.js';
import binWgsl from './wgsl/bin.wgsl?raw';
import collideWgsl from './wgsl/collide.wgsl?raw';
import contactsWgsl from './wgsl/contacts.wgsl?raw';
import settleWgsl from './wgsl/settle.wgsl?raw';
import sortWgsl from './wgsl/sort.wgsl?raw';

/**
 * The second kind of constraint: bodies do not pass through each other.
 *
 * It shares the nodes with the elastic constraint and agrees with it on nothing
 * else, which is the whole reason the seam under both of them is drawn where it
 * is. Elasticity knows its constraints before the simulation starts and can
 * batch them by parity; contact does not know a single one of its own until the
 * substep is under way, and could not colour them if it did, because a contact
 * couples two bodies and parity is only disjoint within one. So this one is
 * Jacobi -- bin, canonicalise, gather, apply -- in four dispatches that the stepper
 * dispatches without knowing what any of them do.
 *
 * The container walls are deliberately not here. They are the legacy tank's
 * five fixed planes or the scene container's six fixed planes, known
 * in advance, they belong to the world rather than to any body, and they are
 * already resolved per node in the stepper's closing pass. Nothing about this
 * file would be shared with them.
 *
 * @typedef {object} ContactBody
 * @property {import('../discretize/lattice.js').Lattice} lattice - Its discretisation.
 */

/** Threads per workgroup; must match `@workgroup_size` in the kernels. */
const WORKGROUP_SIZE = 64;

/** Nodes a grid bucket holds; must match `BUCKET_SLOTS` in `wgsl/contacts.wgsl`. */
export const BUCKET_SLOTS = 32;

/** Surface record size in bytes, matching `struct Surface` in `wgsl/contacts.wgsl`. */
const SURFACE_STRIDE = 32;

/** Offsets into a surface record, in 4-byte words. */
const SURFACE_FIELDS = {
    node: 0, //   u32
    body: 1, //   u32
    radius: 2 //  f32
};

/**
 * A contact node's radius, as a fraction of its body's cell size.
 *
 * Half a cell is the smallest value that still makes a surface. The boundary
 * nodes sit a cell apart, so spheres any smaller leave gaps between them along
 * the axes and another body's nodes slip through. Larger only inflates the
 * body: contact would resolve further out than the material actually reaches.
 */
const RADIUS_CELLS = 0.5;

/** How much of a node's averaged correction to apply; see `wgsl/settle.wgsl`. */
const GAIN = 1;

export class BodyContact {
    /**
     * @param {import('playcanvas').GraphicsDevice} device - WebGPU device.
     * @param {import('../state/particles.js').Particles} particles - Nodes to move.
     * @param {ContactBody[]} bodies - The bodies that can touch, in scene order.
     * @param {{ min: number[], max: number[] }} bounds - Where they can do it.
     */
    constructor(device, particles, bodies, bounds) {
        this.device = device;
        this.particles = particles;
        this.owned = [];
        this.destroyed = false;
        this.shaders = {};
        this.dispatches = [];

        /**
         * Whether this constraint contributes anything. A whole scheme is
         * easier to judge against its own absence than against a memory of it,
         * and switching it off costs one empty array.
         */
        this.enabled = true;

        // Only boundary nodes take part: an interior node is behind a layer of
        // its own body's boundary, so nothing can reach it without going
        // through material that has already been pushed away.
        /** @type {{ node: number, body: number, radius: number }[]} */
        const records = [];
        let widest = 0;
        let finestH = Infinity;
        for (let b = 0; bodies.length > 1 && b < bodies.length; b++) {
            const { lattice } = bodies[b];
            const offset = particles.offsetOf(b);
            const radius = lattice.h * RADIUS_CELLS;
            widest = Math.max(widest, radius);
            finestH = Math.min(finestH, lattice.h);
            for (const node of surfaceNodes(lattice)) {
                records.push({ node: offset + node, body: b, radius });
            }
        }

        this.surfaceCount = records.length;
        this.grid = broadphaseGrid(bounds, widest * 2);

        // One body has no cross-body pair. In particular, do not size or
        // allocate a scene-wide bucket buffer while preparing the first body.
        if (bodies.length < 2) {
            return;
        }

        // The bucket is sized from the coarsest body (`widest`), so a much
        // finer body sharing the scene can pack far more than the coarse
        // body's own ~1 node per bucket. Past `BUCKET_SLOTS` that turns
        // `wgsl/sort.wgsl`'s rare overflow scan into a routine one -- worth
        // catching here, at scene setup, rather than as an unexplained frame
        // time regression later.
        if (Number.isFinite(finestH)) {
            const worstCase = worstCaseBucketOccupancy(this.grid.cell, finestH);
            if (worstCase > BUCKET_SLOTS) {
                console.warn(
                    `[contact] the finest body's node spacing (${finestH.toFixed(4)}m) can pack ` +
                    `up to ${worstCase} nodes into one ${this.grid.cell.toFixed(4)}m contact ` +
                    `bucket, over the ${BUCKET_SLOTS}-slot capacity. Buckets that dense fall back ` +
                    'to an O(surfaceCount) scan every substep instead of staying rare -- narrow ' +
                    'the resolution gap between bodies in this scene.'
                );
            }
        }

        try {
            const usage = BUFFERUSAGE_COPY_DST | BUFFERUSAGE_COPY_SRC;
            const words = new ArrayBuffer(Math.max(1, records.length) * SURFACE_STRIDE);
            const uints = new Uint32Array(words);
            const floats = new Float32Array(words);
            const stride = SURFACE_STRIDE / 4;
            for (let r = 0; r < records.length; r++) {
                const base = r * stride;
                uints[base + SURFACE_FIELDS.node] = records[r].node;
                uints[base + SURFACE_FIELDS.body] = records[r].body;
                floats[base + SURFACE_FIELDS.radius] = records[r].radius;
            }
            this.surface = this.own(new StorageBuffer(device, words.byteLength, usage));
            this.surface.write(0, new Uint8Array(words));

            // Counters first, then slots behind them. Only counters need an empty
            // value: the bin pass overwrites every slot below the new count, and
            // the local sort pass orders exactly that live prefix.
            const gridWords = this.grid.bucketCount * (1 + BUCKET_SLOTS);
            this.contactGrid = this.own(new StorageBuffer(device, gridWords * 4, usage));
            this.contactGrid.write(0, new Uint32Array(gridWords));

            this.shaders.bin = this.own(this.kernel('sim-contact-bin', binWgsl));
            this.shaders.sort = this.own(this.kernel('sim-contact-sort', sortWgsl));
            this.shaders.collide = this.own(this.kernel('sim-contact-collide', collideWgsl));
            this.shaders.settle = this.own(this.kernel('sim-contact-settle', settleWgsl));

            if (this.surfaceCount > 0) {
                const perNode = Math.ceil(this.surfaceCount / WORKGROUP_SIZE);
                this.dispatches.push(
                    this.pass('bin', perNode),
                    // One thread owns one bucket and sorts its short live prefix.
                    this.pass('sort', Math.ceil(this.grid.bucketCount / WORKGROUP_SIZE)),
                    this.pass('collide', perNode),
                    this.pass('settle', Math.ceil(
                        Math.max(this.surfaceCount, this.grid.bucketCount) / WORKGROUP_SIZE))
                );
            }
        } catch (error) {
            try { this.destroy(); } catch {}
            throw error;
        }
    }

    own(resource) {
        this.owned.push(resource);
        return resource;
    }

    /**
     * @param {string} name - Shader name, for debugging.
     * @param {string} body - Kernel source.
     * @returns {Shader} The compiled kernel, with both sets of declarations.
     */
    kernel(name, body) {
        return new Shader(this.device, {
            name,
            shaderLanguage: SHADERLANGUAGE_WGSL,
            cshader: `${STATE_WGSL}\n${contactsWgsl}\n${body}`
        });
    }

    /**
     * @param {string} name - Which of the four kernels.
     * @param {number} groups - Workgroups to dispatch.
     * @returns {Compute} The configured dispatch.
     */
    pass(name, groups) {
        const compute = this.own(new Compute(this.device, this.shaders[name], `sim-contact-${name}`));
        // Every kernel carries every declaration, so every kernel is bound the
        // same way. Which of them a given kernel reads is the kernel's business.
        for (const [binding, buffer] of Object.entries(this.particles.bindings)) {
            compute.setParameter(binding, buffer);
        }
        compute.setParameter('surface', this.surface);
        compute.setParameter('contactGrid', this.contactGrid);
        compute.setParameter('gridOrigin', this.grid.origin);
        compute.setParameter('gridDims', this.grid.dims);
        compute.setParameter('gridCell', this.grid.cell);
        compute.setParameter('bucketCount', this.grid.bucketCount);
        compute.setParameter('surfaceCount', this.surfaceCount);
        compute.setParameter('gain', GAIN);
        compute.setupDispatch(groups, 1, 1);
        return compute;
    }

    /**
     * The dispatches this constraint contributes to one substep, in order.
     *
     * @returns {Compute[]} The passes, or none while it is switched off.
     */
    get passes() {
        return this.enabled ? this.dispatches : [];
    }

    /**
     * Told the substep duration, and has no use for it.
     *
     * Contact here is a hard constraint: the overlap is removed outright rather
     * than resisted by a compliance, so there is no `alpha / dt^2` for the
     * substep length to enter through. Friction is a position-level rule over
     * the motion since the substep began, which is a difference of positions
     * and carries its own time with it.
     */
    setSubstepDt() {}

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        let failure = null;
        for (const resource of this.owned.reverse()) {
            try { resource.destroy(); } catch (error) { failure ??= error; }
        }
        this.owned.length = 0;
        if (failure) throw failure;
    }
}
