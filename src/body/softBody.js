import { KUHN_TET_VOLUME_FRACTION } from '../geometry/kuhn.js';
import { DEFAULT_MATERIAL, elementConstants, waveSpeed } from './material.js';

/**
 * One simulated object, and the single place that knows everything downstream
 * needs about it: what it looks like, what it is made of, and how it is
 * discretised.
 *
 * The render geometry and the simulation geometry are deliberately independent.
 * The lattice is the only thing the solver sees; the render geometry is
 * embedded in it and may be a triangle mesh today and a Gaussian splat cloud
 * later without the solver noticing.
 */
export class SoftBody {
    /**
     * @param {object} options - Body options.
     * @param {string} options.name - Identifier, also used in the UI.
     * @param {import('../geometry/lattice.js').Lattice} options.lattice - Simulation geometry.
     * @param {import('./material.js').Material} [options.material] - Material parameters.
     * @param {import('../geometry/objLoader.js').TriangleMesh} [options.renderMesh] - Rest-space render geometry.
     * @param {number[]} [options.tint] - Linear RGB base colour.
     */
    constructor({ name, lattice, material, renderMesh = null, tint = [0.92, 0.45, 0.26] }) {
        this.name = name;
        this.lattice = lattice;
        this.material = { ...DEFAULT_MATERIAL, ...material };
        this.renderMesh = renderMesh;
        this.tint = tint;
    }

    /** @returns {number} Rest volume of a single Kuhn tetrahedron, in m^3. */
    get tetRestVolume() {
        return KUHN_TET_VOLUME_FRACTION * this.lattice.h ** 3;
    }

    /**
     * XPBD compliances for this body's material.
     *
     * Cheap to recompute, which is what makes the material sliders live: only
     * a handful of uniforms change, never the lattice.
     *
     * @returns {{ deviatoric: number, hydrostatic: number, gamma: number }} Solver constants.
     */
    get solverConstants() {
        return elementConstants(this.material, this.tetRestVolume);
    }

    /**
     * Cell crossings per second: how fast an elastic wave moves through this
     * body relative to its own cell size.
     *
     * Multiplying by a substep duration gives the CFL number, so this is the
     * quantity that decides how finely the body has to be stepped. It belongs
     * to the body rather than to the material because it mixes the two: a stiff
     * material in coarse cells can be cheaper to step than a soft one in fine
     * cells, and pairing the scene's fastest material with the scene's smallest
     * cell -- usually different bodies -- overstates the requirement badly.
     *
     * @returns {number} Wave speed divided by cell size, in 1/s.
     */
    get waveRatio() {
        return waveSpeed(this.material) / this.lattice.h;
    }

    /**
     * Changes density, re-lumping the node masses to match.
     *
     * This is the one material edit that is not just a uniform upload, and it
     * lives here because the body owns the invariant it maintains: node inverse
     * masses have to stay consistent with `density * volume`. Doing it from
     * outside means reading the old density before overwriting it, which is
     * exactly the ordering the caller should not have to know about.
     *
     * @param {number} density - New density in kg/m^3.
     * @returns {boolean} True when the node masses changed and need re-uploading.
     */
    setDensity(density) {
        const previous = this.material.density;
        if (!(density > 0) || density === previous) {
            return false;
        }

        const ratio = previous / density;
        const { invMass, nodeCount } = this.lattice;
        for (let n = 0; n < nodeCount; n++) {
            invMass[n] *= ratio;
        }
        this.lattice.mass = this.lattice.volume * density;
        this.material.density = density;
        return true;
    }

    /** @returns {number} Nodes in the lattice, including inert padding. */
    get nodeCount() {
        return this.lattice.nodeCount;
    }

    /** @returns {number} Occupied cells, each carrying six tetrahedra. */
    get cellCount() {
        return this.lattice.cells.length;
    }
}
