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
 * The two geometries are separate fields because they are separate things. The
 * source is what the solver is given to cut up; the render payload is what gets
 * drawn and carried along by the result. They coincide for a mesh and they do
 * not for a capture, where the same Gaussians serve as both and the simulator
 * still has to invent a volume from them.
 *
 * @typedef {{ kind: 'mesh', mesh: import('../assets/objLoader.js').TriangleMesh }
 *         | { kind: 'shape', shape: import('../assets/shapes.js').Shape }
 *         | { kind: 'cloud', cloud: import('../assets/splats/cloud.js').SplatCloud, report?: string }}
 *   RestGeometry
 *
 * A capture carries the measurements taken when it was placed. Not decoration:
 * a PLY states neither its up axis nor its units, so both were declared by hand
 * upstream, and a declaration nobody checks is a guess.
 *
 * The render payload is tagged by what it is made of rather than by where it
 * came from, because that is all whoever draws it gets to know.
 *
 * @typedef {{ kind: 'triangles', mesh: import('../assets/objLoader.js').TriangleMesh }
 *         | { kind: 'gaussians', cloud: import('../assets/splats/cloud.js').SplatCloud }}
 *   RenderGeometry
 */
export class SoftBody {
    /**
     * @param {object} options - Body options.
     * @param {string} options.name - Identifier, also used in the UI.
     * @param {RestGeometry} options.source - Rest shape, already placed in the world.
     * @param {import('./material.js').Material} [options.material] - Material parameters.
     * @param {RenderGeometry} [options.render] - Rest-space geometry to draw.
     * @param {(x: number, y: number, z: number) => boolean} [options.staticRegion] -
     *   Region prescribed at rest, in world metres. Evaluated when simulation
     *   geometry is constructed; no declaration means no static prescription.
     * @param {number} [options.elementSize] - Target size of one simulation element, in
     *   metres of world space. What the author asks for, not what the simulator measures
     *   afterwards: the spacing it actually produced is read off the proxy geometry, and
     *   the two are different numbers. A hint to the simulator, not a property of the
     *   object; it lives here only so that everything an author sets about a body is set
     *   in one place.
     * @param {number[]} [options.tint] - Linear RGB base colour.
     */
    constructor({ name, source, material, render = null, staticRegion = null, elementSize = 0.01, tint = [0.92, 0.45, 0.26] }) {
        this.name = name;
        this.source = source;
        this.material = { ...DEFAULT_MATERIAL, ...material };
        validateMaxStretch(this.material.maxStretch);
        this.render = render;
        this.staticRegion = staticRegion;
        this.elementSize = elementSize;
        this.tint = tint;
    }
}
