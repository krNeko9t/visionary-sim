import { DEFAULT_MATERIAL, validateMaxStretch } from './material.js';

/**
 * One object the author put in the scene: what it is called, what it is made
 * of, and what shape it has at rest.
 *
 * Deliberately *not* here: anything about how it gets simulated. A body does
 * not know how it will be cut up, does not own solver constants, and does
 * not know what a node is. The simulation side reads a body and decides all of
 * that, which is what lets that decision change without touching this file.
 *
 * Rest geometry is plain in-memory data in the common simulation world, in
 * metres. Asset preparation and appearance belong to the application.
 *
 * @typedef {import('./restGeometry.js').RestGeometry} RestGeometry
 */
export class SoftBody {
    /**
     * @param {object} options - Body options.
     * @param {string} options.name - Identifier, also used in the UI.
     * @param {RestGeometry} options.source - Rest shape, already placed in the world.
     * @param {import('./material.js').Material} [options.material] - Material parameters.
     * @param {(x: number, y: number, z: number) => boolean} [options.staticRegion] -
     *   Region prescribed at rest, in world metres. Evaluated when simulation
     *   geometry is constructed; no declaration means no static prescription.
     * @param {number} [options.elementSize] - Target size of one simulation element, in
     *   metres of world space. What the author asks for, not what the simulator measures
     *   afterwards: the spacing it actually produced is read off the proxy geometry, and
     *   the two are different numbers. A hint to the simulator, not a property of the
     *   object; it lives here only so that everything an author sets about a body is set
     *   in one place.
     */
    constructor({ name, source, material, staticRegion = null, elementSize = 0.01 }) {
        this.name = name;
        this.source = source;
        this.material = { ...DEFAULT_MATERIAL, ...material };
        validateMaxStretch(this.material.maxStretch);
        this.staticRegion = staticRegion;
        this.elementSize = elementSize;
    }
}
