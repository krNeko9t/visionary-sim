import {
    BUFFERUSAGE_COPY_DST,
    BUFFERUSAGE_COPY_SRC,
    Compute,
    SHADERLANGUAGE_WGSL,
    Shader,
    StorageBuffer
} from 'playcanvas';

import { elementCompliance } from '../../constraints/compliance.js';
import { validateMaxStretch } from '../../../body/material.js';
import xpbdCoupleWgsl from '../../constraints/wgsl/xpbdCouple.wgsl?raw';
import { STATE_WGSL } from '../../state/particles.js';
import { COLOR_COUNT } from './lattice.js';
import { KUHN_TETS, kuhnRestShapeInverses, tetRestVolume } from './kuhn.js';
import { STRETCH_EDGES } from './stretch.js';
import { VoxelLattice } from './voxelLattice.js';
import cellsWgsl from './wgsl/cells.wgsl?raw';
import projectWgsl from './wgsl/project.wgsl?raw';

/**
 * One kind of constraint: the elastic response of a voxel cell, six Kuhn
 * tetrahedra at a time.
 *
 * It lives with the lattice rather than in `sim/constraints/` because the
 * cells, their rest shapes and the rule by which they are batched are all the
 * lattice's knowledge, and a neutral table of cells does not exist (ADR-0007).
 * What it borrows from the solver side is only the formulas: the compliances
 * in `compliance.js` and the 2x2 block in `xpbdCouple.wgsl`. It owns the cells
 * it solves, the buffer that describes them, the shader that projects them,
 * and the batching -- and it hands the stepper nothing but an ordered list of
 * passes to dispatch. The stepper does not know what is in them.
 *
 * That shape is not decoration. Contact between bodies is the next constraint,
 * and it agrees with this one on almost nothing: its constraints are discovered
 * during the substep rather than built once, its count changes every substep,
 * and it couples nodes across bodies, which puts the parity batching below out
 * of reach. The only thing the two share is the nodes they move. So the nodes
 * are what the seam is drawn around, and everything else lives on this side of
 * it.
 *
 * @typedef {object} CellBody
 * @property {import('./lattice.js').Lattice} lattice - Cells and their layout.
 * @property {import('../../../body/material.js').Material} material - What they are made of.
 * @property {number} slot - The body's index in the scene, for `Particles.offsetOf`.
 */

/** Threads per workgroup; must match `@workgroup_size` in the kernel. */
const WORKGROUP_SIZE = 64;

/** CellParams size in bytes, matching the struct in `wgsl/cells.wgsl`. */
const PARAMS_STRIDE = 64;

/** Offsets into CellParams, in 4-byte words. */
const PARAMS_FIELDS = {
    cellDims: 0, //   vec3u
    nodeOffset: 3, // u32
    nodeDims: 4, //   vec3u
    h: 8, //          f32
    alphaDev: 9, //   f32
    alphaHyd: 10, //  f32
    gamma: 11, //     f32
    relaxation: 12, // f32
    maxStretch: 13 // f32
};

const PARAMS_WORDS = PARAMS_STRIDE / 4;

/**
 * @param {number} value - Number to emit.
 * @returns {string} A WGSL f32 literal (which always needs a decimal point).
 */
function f32Literal(value) {
    const text = Object.is(value, -0) ? '0' : String(value);
    return /[.e]/.test(text) ? text : `${text}.0`;
}

/**
 * Emits the Kuhn decomposition as WGSL constants.
 *
 * Generated rather than hand-written so `kuhn.js` stays the single
 * source of truth: the unit tests check the orientation and the inverses there,
 * and the GPU gets exactly what they checked.
 *
 * They are `var<private>` rather than `const` because the kernel indexes them
 * with a loop variable, and dynamic indexing is unambiguously allowed in the
 * private address space.
 *
 * @returns {string} WGSL source.
 */
function kuhnConstants() {
    const tets = KUHN_TETS
        .map(tet => `        vec4u(${tet.map(c => `${c}u`).join(', ')})`)
        .join(',\n');

    const inverses = kuhnRestShapeInverses(1)
        .map((m) => {
            const column = c => `vec3f(${[0, 1, 2].map(r => f32Literal(m[c * 3 + r])).join(', ')})`;
            return `        mat3x3f(${column(0)}, ${column(1)}, ${column(2)})`;
        })
        .join(',\n');

    return [
        '// Generated from sim/discretize/lattice/kuhn.js -- do not edit here.',
        `var<private> KUHN_TETS: array<vec4u, 6> = array<vec4u, 6>(\n${tets}\n);`,
        '// Rest shape inverses for a unit cube; scaled by 1/h per body.',
        `var<private> KUHN_REST_INV: array<mat3x3f, 6> = array<mat3x3f, 6>(\n${inverses}\n);`,
        `var<private> STRETCH_EDGES: array<vec3f, 28> = array<vec3f, 28>(\n${
            STRETCH_EDGES.map(edge => `    vec3f(${edge.map(f32Literal).join(', ')})`).join(',\n')
        }\n);`,
        ''
    ].join('\n');
}

/**
 * `elasticConstraints()` of `discretize.js`, for every lattice in the scene at once.
 *
 * All of them go into one {@link ElasticCells}, so that a colour is one
 * dispatch across the scene rather than one per body. That is co-location, not
 * coupling: it is safe because bodies own disjoint node ranges (I6).
 *
 * @param {import('playcanvas').GraphicsDevice} device - WebGPU device.
 * @param {import('../../state/particles.js').Particles} particles - Every body's nodes.
 * @param {import('../proxyGeometry.js').ProxyGeometry[]} proxies - Every body's
 *   proxy, in scene order; the ones that are not lattices are someone else's.
 * @param {import('../../../body/material.js').Material[]} materials - Each
 *   body's material, same order. Read again on every `uploadParams()`, so edit
 *   them in place.
 * @returns {import('../proxyGeometry.js').ElasticConstraint[]} Nothing if no
 *   body is a lattice, one constraint otherwise.
 */
export function elasticConstraints(device, particles, proxies, materials) {
    const bodies = proxies.flatMap((proxy, slot) => (proxy instanceof VoxelLattice
        ? [{ lattice: proxy.lattice, material: materials[slot], slot }]
        : []));
    return bodies.length > 0 ? [new ElasticCells(device, particles, bodies)] : [];
}

export class ElasticCells {
    /**
     * @param {import('playcanvas').GraphicsDevice} device - WebGPU device.
     * @param {import('../../state/particles.js').Particles} particles - Nodes to move.
     * @param {CellBody[]} bodies - Lattices and their materials, in scene order.
     */
    constructor(device, particles, bodies) {
        this.device = device;
        this.particles = particles;
        this.bodies = bodies;

        // Cells are grouped by colour across *all* bodies, so one dispatch per
        // colour covers the scene rather than one per colour per body.
        const total = bodies.reduce((sum, { lattice }) => sum + lattice.cells.length, 0);
        const entries = new Uint32Array(total * 2);
        this.cellCount = total;
        this.colorRanges = [];

        let cursor = 0;
        for (let color = 0; color < COLOR_COUNT; color++) {
            const start = cursor;
            for (let b = 0; b < bodies.length; b++) {
                const { cells, colorRanges } = bodies[b].lattice;
                const range = colorRanges[color];
                for (let n = 0; n < range.count; n++) {
                    entries[cursor * 2] = b;
                    entries[cursor * 2 + 1] = cells[range.start + n];
                    cursor++;
                }
            }
            this.colorRanges.push({ start, count: cursor - start });
        }

        const usage = BUFFERUSAGE_COPY_DST | BUFFERUSAGE_COPY_SRC;
        this.cells = new StorageBuffer(device, entries.byteLength, usage);
        this.cellParams = new StorageBuffer(device, bodies.length * PARAMS_STRIDE, usage);
        this.cells.write(0, entries);

        // One staging copy reused for every material update, so dragging a
        // slider does not allocate.
        this.paramWords = new ArrayBuffer(bodies.length * PARAMS_STRIDE);
        this.paramFloats = new Float32Array(this.paramWords);
        this.paramUints = new Uint32Array(this.paramWords);
        this.uploadParams();

        this.shader = new Shader(device, {
            name: 'sim-elastic-cells',
            shaderLanguage: SHADERLANGUAGE_WGSL,
            cshader: `${kuhnConstants()}\n${STATE_WGSL}\n${xpbdCoupleWgsl}\n${cellsWgsl}\n${projectWgsl}`
        });

        // One instance per colour: same shader, but each carries its own range
        // in its own uniform buffer, so all eight can be queued at once. Empty
        // colours are dropped rather than dispatched to do nothing.
        const batches = limitOnly => this.colorRanges
            .map((range, color) => ({ range, color }))
            .filter(({ range }) => range.count > 0)
            .map(({ range, color }) => {
                const compute = new Compute(device, this.shader, `sim-elastic-${color}`);
                compute.setParameter('colorStart', range.start);
                compute.setParameter('colorCount', range.count);
                compute.setParameter('limitOnly', limitOnly);
                compute.setParameter('cells', this.cells);
                compute.setParameter('cellParams', this.cellParams);
                for (const [name, buffer] of Object.entries(particles.bindings)) {
                    compute.setParameter(name, buffer);
                }
                compute.setupDispatch(Math.ceil(range.count / WORKGROUP_SIZE), 1, 1);
                return compute;
            });
        this.batches = batches(0);
        this.stretchBatches = batches(1);
        // Neighbouring colour updates can violate an earlier colour's bound.
        // Three further sweeps reduce that residual without re-applying the
        // elastic energy (which would silently change the material stiffness).
        this.limitedPasses = [...this.batches, ...this.stretchBatches, ...this.stretchBatches, ...this.stretchBatches];
    }

    /**
     * The dispatches this constraint contributes to one substep, in order.
     *
     * @returns {Compute[]} The passes.
     */
    get passes() {
        return this.bodies.some(({ material }) => material.maxStretch > 1)
            ? this.limitedPasses
            : this.batches;
    }

    /**
     * Rewrites the per-body constants from the bodies' current materials.
     *
     * Cheap by design, and that is what makes the material sliders live: only a
     * handful of numbers change, never a cell and never the batching.
     */
    uploadParams() {
        const { paramFloats, paramUints, bodies, particles } = this;

        for (let b = 0; b < bodies.length; b++) {
            const { lattice, material, slot } = bodies[b];
            const { cellDims, nodeDims, h } = lattice;
            const { deviatoric, hydrostatic, gamma } = elementCompliance(material, tetRestVolume(h));
            const base = b * PARAMS_WORDS;

            paramUints[base + PARAMS_FIELDS.cellDims] = cellDims[0];
            paramUints[base + PARAMS_FIELDS.cellDims + 1] = cellDims[1];
            paramUints[base + PARAMS_FIELDS.cellDims + 2] = cellDims[2];
            paramUints[base + PARAMS_FIELDS.nodeOffset] = particles.offsetOf(slot);

            paramUints[base + PARAMS_FIELDS.nodeDims] = nodeDims[0];
            paramUints[base + PARAMS_FIELDS.nodeDims + 1] = nodeDims[1];
            paramUints[base + PARAMS_FIELDS.nodeDims + 2] = nodeDims[2];

            paramFloats[base + PARAMS_FIELDS.h] = h;
            paramFloats[base + PARAMS_FIELDS.alphaDev] = deviatoric;
            paramFloats[base + PARAMS_FIELDS.alphaHyd] = hydrostatic;
            paramFloats[base + PARAMS_FIELDS.gamma] = gamma;
            paramFloats[base + PARAMS_FIELDS.relaxation] = material.relaxation;
            paramFloats[base + PARAMS_FIELDS.maxStretch] = validateMaxStretch(material.maxStretch);
        }

        this.cellParams.write(0, new Uint8Array(this.paramWords));
    }

    /**
     * @param {number} dt - Substep duration in seconds.
     */
    setSubstepDt(dt) {
        for (const compute of [...this.batches, ...this.stretchBatches]) {
            compute.setParameter('dt', dt);
        }
    }

    destroy() {
        for (const compute of [...this.batches, ...this.stretchBatches]) {
            compute.destroy();
        }
        this.shader.destroy();
        this.cells.destroy();
        this.cellParams.destroy();
    }
}
