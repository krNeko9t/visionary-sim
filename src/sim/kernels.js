import { Compute, SHADERLANGUAGE_WGSL, Shader } from 'playcanvas';

import { KUHN_TETS, kuhnRestShapeInverses } from '../geometry/kuhn.js';
import commonWgsl from './wgsl/common.wgsl?raw';
import contactWgsl from './wgsl/contact.wgsl?raw';
import elasticWgsl from './wgsl/elastic.wgsl?raw';
import integrateWgsl from './wgsl/integrate.wgsl?raw';

/** Threads per workgroup; must match `@workgroup_size` in the kernels. */
const WORKGROUP_SIZE = 64;

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
 * Generated rather than hand-written so `geometry/kuhn.js` stays the single
 * source of truth: the unit tests check the orientation and the inverses there,
 * and the GPU gets exactly what they checked.
 *
 * They are `var<private>` rather than `const` because the solver indexes them
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
        '// Generated from geometry/kuhn.js -- do not edit here.',
        `var<private> KUHN_TETS: array<vec4u, 6> = array<vec4u, 6>(\n${tets}\n);`,
        '// Rest shape inverses for a unit cube; scaled by 1/h per body.',
        `var<private> KUHN_REST_INV: array<mat3x3f, 6> = array<mat3x3f, 6>(\n${inverses}\n);`,
        ''
    ].join('\n');
}

/**
 * @param {import('playcanvas').GraphicsDevice} device - WebGPU device.
 * @param {string} name - Shader name, for debugging.
 * @param {string} body - Kernel source, appended to the shared declarations.
 * @returns {Shader} The compiled compute shader.
 */
function computeShader(device, name, body) {
    return new Shader(device, {
        name,
        shaderLanguage: SHADERLANGUAGE_WGSL,
        cshader: `${kuhnConstants()}\n${commonWgsl}\n${body}`
    });
}

/**
 * The simulation's compute kernels and the per-frame dispatch sequence.
 *
 * Every dispatch of a frame goes into a single `computeDispatch` call, which
 * records them into one compute pass. WebGPU orders dispatches within a pass
 * and handles the read-after-write hazards between them, which is exactly the
 * dependency structure a substep needs.
 */
export class SimKernels {
    /**
     * @param {import('playcanvas').GraphicsDevice} device - WebGPU device.
     * @param {import('./arena.js').SimArena} arena - Scene storage.
     */
    constructor(device, arena) {
        this.device = device;
        this.arena = arena;

        const shaders = {
            integrate: computeShader(device, 'sim-integrate', integrateWgsl),
            elastic: computeShader(device, 'sim-elastic', elasticWgsl),
            contact: computeShader(device, 'sim-contact', contactWgsl)
        };
        this.shaders = shaders;

        const nodeGroups = Math.ceil(arena.nodeCount / WORKGROUP_SIZE);

        this.integrate = new Compute(device, shaders.integrate, 'sim-integrate');
        this.integrate.setupDispatch(nodeGroups, 1, 1);

        this.contact = new Compute(device, shaders.contact, 'sim-contact');
        this.contact.setupDispatch(nodeGroups, 1, 1);

        // One instance per colour: same shader, but each carries its own range
        // in its own uniform buffer, so all eight can be queued at once.
        this.elastic = arena.colorRanges.map((range, color) => {
            const compute = new Compute(device, shaders.elastic, `sim-elastic-${color}`);
            compute.setParameter('colorStart', range.start);
            compute.setParameter('colorCount', range.count);
            compute.setupDispatch(Math.max(1, Math.ceil(range.count / WORKGROUP_SIZE)), 1, 1);
            return compute;
        });

        this.all = [this.integrate, this.contact, ...this.elastic];
        for (const compute of this.all) {
            for (const [name, buffer] of Object.entries(arena.bindings)) {
                compute.setParameter(name, buffer);
            }
        }

        this.integrate.setParameter('nodeCount', arena.nodeCount);
        this.contact.setParameter('nodeCount', arena.nodeCount);

        // Colour groups that ended up empty would dispatch a workgroup that
        // does nothing; drop them from the sequence instead.
        this.activeElastic = this.elastic.filter((_, color) => arena.colorRanges[color].count > 0);
    }

    /**
     * @param {object} params - Per-frame parameters.
     * @param {number} params.substepDt - Substep duration in seconds.
     * @param {number[]} params.gravity - Gravity vector.
     * @param {number[]} params.tankMin - Tank interior minimum.
     * @param {number[]} params.tankMax - Tank interior maximum.
     * @param {number[]} params.grabTarget - World position a grabbed node is pinned to.
     */
    setFrameParameters({ substepDt, gravity, tankMin, tankMax, grabTarget }) {
        this.integrate.setParameter('dt', substepDt);
        this.integrate.setParameter('gravity', gravity);

        for (const compute of this.elastic) {
            compute.setParameter('dt', substepDt);
        }

        this.contact.setParameter('dt', substepDt);
        this.contact.setParameter('tankMin', tankMin);
        this.contact.setParameter('tankMax', tankMax);
        this.contact.setParameter('grabTarget', grabTarget);
    }

    /**
     * Builds the dispatch list for one frame.
     *
     * The same `Compute` instances repeat across substeps. That is safe because
     * their parameters are identical every substep -- `computeDispatch` writes
     * each instance's uniform buffer once and then records every dispatch.
     *
     * @param {number} substeps - Substeps this frame.
     * @returns {Compute[]} The sequence to dispatch.
     */
    sequence(substeps) {
        const list = [];
        for (let s = 0; s < substeps; s++) {
            list.push(this.integrate, ...this.activeElastic, this.contact);
        }
        return list;
    }

    destroy() {
        for (const compute of this.all) {
            compute.destroy();
        }
        for (const shader of Object.values(this.shaders)) {
            shader.destroy();
        }
    }
}
