import { Compute, SHADERLANGUAGE_WGSL, Shader } from 'playcanvas';

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
 * Every dispatch of a frame goes into a single `computeDispatch` call, which
 * records them into one compute pass. WebGPU orders dispatches within a pass
 * and handles the read-after-write hazards between them, which is exactly the
 * dependency structure a substep needs.
 *
 * @typedef {object} ConstraintSet
 * @property {Compute[]} passes - Dispatches this constraint wants per substep, in order.
 * @property {(dt: number) => void} setSubstepDt - Told the substep duration each frame.
 */

/** Threads per workgroup; must match `@workgroup_size` in the kernels. */
const WORKGROUP_SIZE = 64;

/**
 * @param {import('playcanvas').GraphicsDevice} device - WebGPU device.
 * @param {string} name - Shader name, for debugging.
 * @param {string} body - Kernel source, appended to the particle declarations.
 * @returns {Shader} The compiled compute shader.
 */
function nodeKernel(device, name, body) {
    return new Shader(device, {
        name,
        shaderLanguage: SHADERLANGUAGE_WGSL,
        cshader: `${STATE_WGSL}\n${body}`
    });
}

export class Stepper {
    /**
     * @param {import('playcanvas').GraphicsDevice} device - WebGPU device.
     * @param {import('../state/particles.js').Particles} particles - Nodes to advance.
     * @param {ConstraintSet[]} constraints - What those nodes must obey, in solve order.
     */
    constructor(device, particles, constraints) {
        this.device = device;
        this.particles = particles;
        this.constraints = constraints;

        this.shaders = {
            predict: nodeKernel(device, 'sim-predict', predictWgsl),
            finalize: nodeKernel(device, 'sim-finalize', finalizeWgsl)
        };

        const groups = Math.ceil(particles.nodeCount / WORKGROUP_SIZE);
        this.predict = new Compute(device, this.shaders.predict, 'sim-predict');
        this.predict.setupDispatch(groups, 1, 1);
        this.finalize = new Compute(device, this.shaders.finalize, 'sim-finalize');
        this.finalize.setupDispatch(groups, 1, 1);

        this.own = [this.predict, this.finalize];
        for (const compute of this.own) {
            for (const [name, buffer] of Object.entries(particles.bindings)) {
                compute.setParameter(name, buffer);
            }
            compute.setParameter('nodeCount', particles.nodeCount);
        }
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
        this.predict.setParameter('dt', substepDt);
        this.predict.setParameter('gravity', gravity);

        this.finalize.setParameter('dt', substepDt);
        this.finalize.setParameter('tankMin', tankMin);
        this.finalize.setParameter('tankMax', tankMax);
        this.finalize.setParameter('grabTarget', grabTarget);

        for (const constraint of this.constraints) {
            constraint.setSubstepDt(substepDt);
        }
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
        const projections = this.constraints.flatMap(constraint => constraint.passes);
        const list = [];
        for (let s = 0; s < substeps; s++) {
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
