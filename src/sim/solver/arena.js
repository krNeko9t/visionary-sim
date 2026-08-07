import { BUFFERUSAGE_COPY_DST, BUFFERUSAGE_COPY_SRC, StorageBuffer } from 'playcanvas';

import { COLOR_COUNT } from '../discretize/lattice.js';
import { elementCompliance } from './compliance.js';

/**
 * GPU-side storage for the whole scene, in one set of buffers.
 *
 * Bodies are concatenated rather than given their own buffers, for two reasons:
 * the number of dispatches stays independent of the number of bodies, and a
 * colour group can span every body at once, so eight dispatches solve the whole
 * scene rather than eight per body.
 *
 * Nothing here is read back per frame. The only readback in the system is a
 * single node index when the pointer goes down.
 */

/** Body struct size in bytes, matching the layout in `wgsl/common.wgsl`. */
const BODY_STRIDE = 80;

/** Offsets into the body struct, in 4-byte words. */
const BODY_FIELDS = {
    origin: 0, //      vec3f
    h: 3, //           f32
    cellDims: 4, //    vec3u
    nodeOffset: 7, //  u32
    nodeDims: 8, //    vec3u
    nodeCount: 11, //  u32
    alphaDev: 12, //   f32
    alphaHyd: 13, //   f32
    gamma: 14, //      f32
    damping: 15, //    f32
    friction: 16, //   f32
    grabNode: 17 //    i32
};

const BODY_WORDS = BODY_STRIDE / 4;

export class SimArena {
    /**
     * @param {import('playcanvas').GraphicsDevice} device - WebGPU device.
     * @param {import('../simulator.js').SimBody[]} simBodies - Bodies and their lattices.
     */
    constructor(device, simBodies) {
        this.device = device;
        this.simBodies = simBodies;

        let nodeTotal = 0;
        let cellTotal = 0;
        /** Where each body's nodes start in the shared arrays. */
        this.nodeOffsets = simBodies.map(({ lattice }) => {
            const offset = nodeTotal;
            nodeTotal += lattice.nodeCount;
            cellTotal += lattice.cells.length;
            return offset;
        });
        this.nodeCount = nodeTotal;
        this.cellCount = cellTotal;

        const positions = new Float32Array(nodeTotal * 4);
        const invMass = new Float32Array(nodeTotal);
        for (let b = 0; b < simBodies.length; b++) {
            const { restPositions, invMass: bodyInvMass, nodeCount } = simBodies[b].lattice;
            const offset = this.nodeOffsets[b];
            for (let n = 0; n < nodeCount; n++) {
                positions[(offset + n) * 4] = restPositions[n * 3];
                positions[(offset + n) * 4 + 1] = restPositions[n * 3 + 1];
                positions[(offset + n) * 4 + 2] = restPositions[n * 3 + 2];
            }
            invMass.set(bodyInvMass, offset);
        }
        this.restPositions = positions;

        // Cells are grouped by colour across *all* bodies, so one dispatch per
        // colour covers the scene.
        const cellEntries = new Uint32Array(cellTotal * 2);
        this.colorRanges = [];
        let cursor = 0;
        for (let color = 0; color < COLOR_COUNT; color++) {
            const start = cursor;
            for (let b = 0; b < simBodies.length; b++) {
                const { cells, colorRanges } = simBodies[b].lattice;
                const range = colorRanges[color];
                for (let n = 0; n < range.count; n++) {
                    cellEntries[cursor * 2] = b;
                    cellEntries[cursor * 2 + 1] = cells[range.start + n];
                    cursor++;
                }
            }
            this.colorRanges.push({ start, count: cursor - start });
        }

        const usage = BUFFERUSAGE_COPY_DST | BUFFERUSAGE_COPY_SRC;
        this.nodePos = new StorageBuffer(device, positions.byteLength, usage);
        this.nodePrev = new StorageBuffer(device, positions.byteLength, usage);
        this.nodeVel = new StorageBuffer(device, positions.byteLength, usage);
        this.nodeInvMass = new StorageBuffer(device, invMass.byteLength, usage);
        this.cells = new StorageBuffer(device, cellEntries.byteLength, usage);
        this.bodyParams = new StorageBuffer(device, simBodies.length * BODY_STRIDE, usage);

        this.nodePos.write(0, positions);
        this.nodePrev.write(0, positions);
        this.nodeVel.write(0, new Float32Array(nodeTotal * 4));
        this.nodeInvMass.write(0, invMass);
        this.cells.write(0, cellEntries);

        // One staging copy reused for every material update, so changing a
        // slider does not allocate.
        this.bodyWords = new ArrayBuffer(simBodies.length * BODY_STRIDE);
        this.bodyFloats = new Float32Array(this.bodyWords);
        this.bodyUints = new Uint32Array(this.bodyWords);
        this.bodyInts = new Int32Array(this.bodyWords);
        this.grabNodes = simBodies.map(() => -1);

        this.uploadBodies();
    }

    /**
     * Rewrites the per-body parameter buffer from the bodies' current
     * materials. Cheap by design: material sliders never touch the lattice.
     */
    uploadBodies() {
        const { bodyFloats, bodyUints, bodyInts, simBodies } = this;

        for (let b = 0; b < simBodies.length; b++) {
            const { body, lattice } = simBodies[b];
            const { origin, h, cellDims, nodeDims, nodeCount } = lattice;
            const { deviatoric, hydrostatic, gamma } = elementCompliance(body.material, lattice);
            const base = b * BODY_WORDS;

            bodyFloats[base + BODY_FIELDS.origin] = origin[0];
            bodyFloats[base + BODY_FIELDS.origin + 1] = origin[1];
            bodyFloats[base + BODY_FIELDS.origin + 2] = origin[2];
            bodyFloats[base + BODY_FIELDS.h] = h;

            bodyUints[base + BODY_FIELDS.cellDims] = cellDims[0];
            bodyUints[base + BODY_FIELDS.cellDims + 1] = cellDims[1];
            bodyUints[base + BODY_FIELDS.cellDims + 2] = cellDims[2];
            bodyUints[base + BODY_FIELDS.nodeOffset] = this.nodeOffsets[b];

            bodyUints[base + BODY_FIELDS.nodeDims] = nodeDims[0];
            bodyUints[base + BODY_FIELDS.nodeDims + 1] = nodeDims[1];
            bodyUints[base + BODY_FIELDS.nodeDims + 2] = nodeDims[2];
            bodyUints[base + BODY_FIELDS.nodeCount] = nodeCount;

            bodyFloats[base + BODY_FIELDS.alphaDev] = deviatoric;
            bodyFloats[base + BODY_FIELDS.alphaHyd] = hydrostatic;
            bodyFloats[base + BODY_FIELDS.gamma] = gamma;
            bodyFloats[base + BODY_FIELDS.damping] = body.material.damping;
            bodyFloats[base + BODY_FIELDS.friction] = body.material.friction;
            bodyInts[base + BODY_FIELDS.grabNode] = this.grabNodes[b];
        }

        this.bodyParams.write(0, new Uint8Array(this.bodyWords));
    }

    /**
     * Density changes the node masses, which live in a different buffer from
     * the material constants, so this is the one material edit that is not free.
     */
    uploadMasses() {
        const invMass = new Float32Array(this.nodeCount);
        for (let b = 0; b < this.simBodies.length; b++) {
            invMass.set(this.simBodies[b].lattice.invMass, this.nodeOffsets[b]);
        }
        this.nodeInvMass.write(0, invMass);
    }

    /**
     * @param {number} bodyIndex - Index of the body being grabbed, or -1 to release all.
     * @param {number} nodeIndex - Arena-global node index, or -1 to release.
     */
    setGrab(bodyIndex, nodeIndex) {
        this.grabNodes.fill(-1);
        if (bodyIndex >= 0) {
            this.grabNodes[bodyIndex] = nodeIndex;
        }
        this.uploadBodies();
    }

    /** Returns every buffer, keyed by its name in the WGSL. */
    get bindings() {
        return {
            nodePos: this.nodePos,
            nodePrev: this.nodePrev,
            nodeVel: this.nodeVel,
            nodeInvMass: this.nodeInvMass,
            cells: this.cells,
            bodies: this.bodyParams
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

