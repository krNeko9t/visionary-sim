/** @typedef {import('../compute/backend.js').ComputeBackend} ComputeBackend */
/** @typedef {ReturnType<ComputeBackend['kernel']>} Kernel */
/** @typedef {ReturnType<ComputeBackend['pass']>} Pass */

import { STATE_WGSL } from '../state/particles.js';
import finalizeWgsl from './wgsl/finalize.wgsl?raw';
import predictWgsl from './wgsl/predict.wgsl?raw';

/**
 * The substep loop: predict, let every constraint have its say, close.
 *
 * What it knows about a constraint is exactly one thing -- the ordered list of
 * dispatches it wants per substep -- and it learns that by asking. It does not
 * know how many kinds there are, what they solve, what buffers they own, or how
 * they decided to batch themselves. Adding a second kind is adding an element
 * to an array, not editing this file.
 *
 * Every dispatch of a frame goes into a single `dispatch` call, which
 * records them into one compute pass. WebGPU orders dispatches within a pass
 * and handles the read-after-write hazards between them, which is exactly the
 * dependency structure a substep needs.
 *
 * @typedef {object} ConstraintSet
 * @property {Pass[]} passes - Dispatches this constraint wants per substep, in order.
 * @property {(dt: number) => void} setSubstepDt - Told the substep duration each frame.
 */

/** Threads per workgroup; must match `@workgroup_size` in the kernels. */
const WORKGROUP_SIZE = 64;

/**
 * @param {ComputeBackend} backend - WebGPU backend.
 * @param {string} name - Shader name, for debugging.
 * @param {string} body - Kernel source, appended to the particle declarations.
 * @returns {Kernel} The compiled compute shader.
 */
function nodeKernel(backend, name, body) {
    return backend.kernel(name, `${STATE_WGSL}\n${body}`);
}

export class Stepper {
    /**
     * @param {ComputeBackend} backend - WebGPU backend.
     * @param {import('../state/particles.js').Particles} particles - Nodes to advance.
     * @param {ConstraintSet[]} constraints - What those nodes must obey, in solve order.
     */
    constructor(backend, particles, constraints) {
        this.particles = particles;
        this.constraints = constraints;

        this.shaders = {
            predict: nodeKernel(backend, 'sim-predict', predictWgsl),
            finalize: nodeKernel(backend, 'sim-finalize', finalizeWgsl)
        };

        const groups = Math.ceil(particles.nodeCount / WORKGROUP_SIZE);
        this.predict = backend.pass(this.shaders.predict, 'sim-predict');
        this.predict.setupDispatch(groups, 1, 1);
        this.finalize = backend.pass(this.shaders.finalize, 'sim-finalize');
        this.finalize.setupDispatch(groups, 1, 1);

        this.own = [this.predict, this.finalize];
        for (const compute of this.own) {
            for (const [name, buffer] of Object.entries(particles.bindings)) {
                compute.set(name, buffer);
            }
            compute.set('nodeCount', particles.nodeCount);
        }
    }

    /**
     * @param {object} params - Per-frame parameters.
     * @param {number} params.substepDt - Substep duration in seconds.
     * @param {number[]} params.gravity - Gravity vector.
     * @param {number[]} params.tankMin - Tank interior minimum.
     * @param {number[]} params.tankMax - Tank interior maximum.
     */
    setFrameParameters({ substepDt, gravity, tankMin, tankMax }) {
        this.predict.set('dt', substepDt);
        this.predict.set('gravity', gravity);

        this.finalize.set('dt', substepDt);
        this.finalize.set('tankMin', tankMin);
        this.finalize.set('tankMax', tankMax);

        for (const constraint of this.constraints) {
            constraint.setSubstepDt(substepDt);
        }
    }

    /**
     * Builds the dispatch list for one frame.
     *
     * The same pass instances repeat across substeps. That is safe because
     * their parameters are identical every substep -- `dispatch` writes
     * each instance's uniform buffer once and then records every dispatch.
     *
     * @param {number} steps - Fixed physical steps this render frame.
     * @returns {Pass[]} The sequence to dispatch.
     */
    sequence(steps) {
        const projections = this.constraints.flatMap(constraint => constraint.passes);
        const list = [];
        for (let s = 0; s < steps; s++) {
            list.push(this.predict, ...projections, this.finalize);
        }
        return list;
    }

    destroy() {
        for (const compute of this.own) {
            compute.destroy();
        }
        for (const shader of Object.values(this.shaders)) {
            shader.destroy();
        }
    }
}
