import { bodyOfNode, nearestNodeToRay } from './pick.js';
import { discretizeBody, relumpMasses } from './discretize/discretize.js';
import { BodyContact } from './constraints/bodyContact.js';
import { ElasticCells } from './constraints/elasticCells.js';
import { Particles } from './state/particles.js';
import { Stepper } from './solver/stepper.js';
import { collapseScale, elementCompliance, waveRatio } from './constraints/compliance.js';

/**
 * The simulation's only public surface.
 *
 * Everything outside `sim/` talks to this object: the scene hands it bodies,
 * the UI changes materials, the grabber pins a node. Nothing outside touches a
 * buffer, a kernel or a dispatch -- and nothing outside decides how a body is
 * cut up, which is this object's first act.
 *
 * @typedef {object} SimBody
 * @property {import('../body/softBody.js').SoftBody} body - What the author described.
 * @property {import('./discretize/lattice.js').Lattice} lattice - How this simulator chose
 *   to discretise it. The seam between the two is exactly this pairing.
 */

const DEFAULT_PARAMS = {
    gravity: [0, -9.81, 0],
    substeps: 20,
    /** Ceiling on substeps, so a stiff material costs accuracy rather than frames. */
    maxSubsteps: 24,
    paused: false,
    /** Frame time is clamped so a stall cannot fire a huge, unstable step. */
    maxFrameTime: 1 / 30
};

/** Target CFL number, kept below 1 so the projections stay compliance-damped. */
const CFL_TARGET = 0.75;

export class Simulator {
    /**
     * @param {import('playcanvas').GraphicsDevice} device - WebGPU device.
     * @param {import('../body/softBody.js').SoftBody[]} bodies - Bodies to simulate.
     * @param {{ min: number[], max: number[] }} tank - Tank interior bounds.
     */
    constructor(device, bodies, tank) {
        if (!device.supportsCompute) {
            throw new Error('Simulator requires a device with compute support');
        }
        this.device = device;
        this.tank = tank;
        this.params = { ...DEFAULT_PARAMS };

        /** @type {SimBody[]} */
        this.simBodies = bodies.map(body => ({ body, lattice: discretizeBody(body) }));

        // The three pieces of the simulation side, assembled here and nowhere
        // else. They are listed in dependency order and each knows only the one
        // before it: the nodes exist, constraints move them, a stepper runs the
        // constraints. The stepper never learns what kind of constraint it is
        // running, which is what left room for the second kind.
        // Spelled out rather than handing the lattice over whole: these three
        // arrays are the entire set of things the node storage is allowed to
        // know, and writing them at the seam is what keeps that visible.
        this.particles = new Particles(device, this.simBodies.map(({ lattice }) => ({
            restPositions: lattice.restPositions,
            invMass: lattice.invMass,
            nodeCount: lattice.nodeCount
        })));
        this.elastic = new ElasticCells(device, this.particles, this.simBodies.map(
            ({ body, lattice }) => ({ lattice, material: body.material })
        ));
        this.contact = new BodyContact(
            device, this.particles, this.simBodies.map(({ lattice }) => ({ lattice })), tank
        );
        // Order is solve order. Contact goes last so it has the final word on
        // where a node may be: elasticity can push a node back into whatever it
        // was resting on, and only one of the two is allowed to be wrong about
        // that.
        this.stepper = new Stepper(device, this.particles, [this.elastic, this.contact]);

        for (let b = 0; b < this.simBodies.length; b++) {
            const { damping, friction } = this.simBodies[b].body.material;
            this.particles.setParams(b, { damping, friction });
        }

        this.grab = { body: -1, node: -1, target: [0, 0, 0] };
        this.stepCount = 0;
        /** Set by {@link requestStep}, consumed by the next {@link step}. */
        this.pendingStep = false;
    }

    /**
     * How one body's deformation is handed to anything that wants to be carried
     * by it.
     *
     * This is the whole of the simulation's output. It says where the solver's
     * degrees of freedom currently are and how to read them, and nothing about
     * cells, colours, tetrahedra or constraints -- so a render path can consume
     * it without ever learning that a lattice exists. Everything that draws
     * something goes through here, including the debug view of the lattice
     * itself.
     *
     * @param {number} bodyIndex - Index into the body list.
     * @returns {import('../deformation/bind.js').DeformationField} Its deformation.
     */
    deformationOf(bodyIndex) {
        const { lattice } = this.simBodies[bodyIndex];
        return {
            nodePositions: this.particles.nodePos,
            origin: lattice.origin,
            h: lattice.h,
            cellDims: lattice.cellDims,
            nodeDims: lattice.nodeDims,
            nodeOffset: this.particles.offsetOf(bodyIndex)
        };
    }

    /**
     * How far an elastic wave travels in one substep, as a fraction of a cell,
     * for whichever body has the tightest ratio.
     *
     * This is the number that decides whether the solver is stable, and it is
     * not merely an accuracy heuristic. XPBD only damps a projection while the
     * compliance term `alpha/dt^2` stays above `sum(w |grad C|^2)`; that ratio
     * is this number squared. Above 1 both constraints are projected hard, and
     * a hard projection of the deviatoric constraint `||F|| -> 0` collapses the
     * body to a point.
     *
     * @param {number} [frameTime] - Frame duration in seconds.
     * @returns {number} The CFL number; keep it below 1.
     */
    cflNumber(frameTime = 1 / 60) {
        const { body, lattice } = this.worst();
        return waveRatio(body.material, lattice) * (frameTime / this.params.substeps);
    }

    /**
     * The body whose wave-speed-to-cell-size ratio is setting the substep
     * requirement for the whole scene.
     *
     * Every stability query goes through this one reduction, so there is a
     * single definition of "which body is the problem".
     *
     * @returns {SimBody} The limiting body.
     */
    worst() {
        return this.simBodies.reduce((worst, entry) =>
            (waveRatio(entry.body.material, entry.lattice) >
             waveRatio(worst.body.material, worst.lattice) ? entry : worst));
    }

    /**
     * Substeps needed to hold the CFL number at {@link CFL_TARGET}.
     *
     * @param {number} [frameTime] - Frame duration in seconds.
     * @returns {number} Recommended substeps.
     */
    recommendedSubsteps(frameTime = 1 / 60) {
        const { body, lattice } = this.worst();
        return Math.max(1, Math.ceil((frameTime * waveRatio(body.material, lattice)) / CFL_TARGET));
    }

    /**
     * Applies {@link recommendedSubsteps}, capped by `params.maxSubsteps`.
     *
     * @param {number} [frameTime] - Frame duration in seconds.
     * @returns {{ advised: number, applied: number, cfl: number }} What was chosen.
     */
    autoSubsteps(frameTime = 1 / 60) {
        const advised = this.recommendedSubsteps(frameTime);
        this.params.substeps = Math.min(Math.max(advised, 4), this.params.maxSubsteps);
        return { advised, applied: this.params.substeps, cfl: this.cflNumber(frameTime) };
    }

    /**
     * Everything worth reporting about the current setup, so that callers can
     * print or display it without reaching into the arena or the lattices.
     *
     * @param {number} [frameTime] - Frame duration in seconds.
     * @returns {object} A flat report.
     */
    stats(frameTime = 1 / 60) {
        return {
            deviceType: this.device.deviceType,
            bodyCount: this.simBodies.length,
            cells: this.elastic.cellCount,
            tets: this.elastic.cellCount * 6,
            nodes: this.particles.nodeCount,
            contactNodes: this.contact.surfaceCount,
            contact: this.contact.enabled,
            substeps: this.params.substeps,
            advised: this.recommendedSubsteps(frameTime),
            cfl: this.cflNumber(frameTime),
            limitedBy: this.worst().body.name,
            perBody: this.simBodies.map(({ body, lattice }) => {
                const { gamma } = elementCompliance(body.material, lattice);
                return {
                    name: body.name,
                    h: lattice.h,
                    cells: lattice.cells.length,
                    gamma,
                    collapseScale: collapseScale(gamma)
                };
            })
        };
    }

    /**
     * Advances the simulation by one frame.
     *
     * Must be called inside the render frame -- `computeDispatch` records into
     * the frame's command encoder.
     *
     * @param {number} dt - Elapsed seconds since the last frame.
     */
    step(dt) {
        if (this.pendingStep) {
            this.pendingStep = false;
            this.advance(Math.min(dt, this.params.maxFrameTime));
            return;
        }
        if (this.params.paused) {
            return;
        }
        this.advance(Math.min(dt, this.params.maxFrameTime));
    }

    /**
     * Asks for exactly one frame, paused or not.
     *
     * Deferred rather than run here, because a dispatch is only legal inside
     * the render frame and the thing that wants a single step is a button
     * click. Keeping that rule inside this class is the point: no caller should
     * have to know when a dispatch may be recorded.
     */
    requestStep() {
        this.pendingStep = true;
    }

    /**
     * @param {number} dt - Frame duration in seconds.
     */
    advance(dt) {
        const { substeps, gravity } = this.params;
        if (dt <= 0 || substeps < 1) {
            return;
        }

        this.stepper.setFrameParameters({
            substepDt: dt / substeps,
            gravity,
            tankMin: this.tank.min,
            tankMax: this.tank.max,
            grabTarget: this.grab.target
        });

        this.device.computeDispatch(this.stepper.sequence(substeps), 'softbody-step');
        this.stepCount += substeps;
    }

    /**
     * Applies a material change. Everything except density is a handful of
     * uniforms; density also has to re-lump the node masses, because those are
     * a property of the discretisation rather than of the material.
     *
     * One material now lands in two places, and the split is the honest one: a
     * node is slowed and rubs against things whatever constraint is holding it,
     * while compliance and gamma mean nothing outside the elastic constraint.
     *
     * @param {number} bodyIndex - Index into the body list.
     * @param {Partial<import('../body/material.js').Material>} changes - Fields to change.
     */
    setMaterial(bodyIndex, changes) {
        const { body, lattice } = this.simBodies[bodyIndex];
        const { density, ...rest } = changes;

        Object.assign(body.material, rest);
        if (density > 0 && density !== body.material.density) {
            relumpMasses(lattice, body.material.density, density);
            body.material.density = density;
            this.particles.uploadMasses();
        }
        this.particles.setParams(bodyIndex, {
            damping: body.material.damping,
            friction: body.material.friction
        });
        this.elastic.uploadParams();
    }

    /**
     * Switches contact between bodies on or off.
     *
     * Worth having a switch for rather than only a constant: with it off the
     * bodies interpenetrate exactly as they did before M5, which is the only
     * way to see what the constraint is actually doing without rebuilding.
     *
     * @param {boolean} enabled - Whether bodies should collide with each other.
     */
    setContact(enabled) {
        this.contact.enabled = enabled;
    }

    /**
     * What a line through the scene hits, as something {@link setGrab} accepts.
     *
     * Asynchronous because the answer lives on the GPU. That is a property of
     * where the simulation runs, not an accident: the caller has to be willing
     * to learn what it grabbed a frame after asking.
     *
     * @param {number[]} origin - Ray origin in world space.
     * @param {number[]} direction - Unit ray direction.
     * @param {object} [options] - Tolerance.
     * @param {number} [options.radius] - How far off the ray a node may be.
     *   Defaults to a little over the coarsest cell, so that anything the
     *   pointer is visibly over has a node within reach.
     * @returns {Promise<{ bodyIndex: number, node: number, position: number[] }|null>}
     *   The grabbable node, or null if the ray missed.
     */
    async pick(origin, direction, { radius = this.coarsestCell() * 1.2 } = {}) {
        const nodes = await this.particles.readPositions();
        const found = nearestNodeToRay(nodes, this.particles.invMass, origin, direction, radius);
        if (found < 0) {
            return null;
        }

        const bodyIndex = bodyOfNode(this.particles.offsets, found);
        return {
            bodyIndex,
            node: found - this.particles.offsetOf(bodyIndex),
            position: [nodes[found * 4], nodes[found * 4 + 1], nodes[found * 4 + 2]]
        };
    }

    /** @returns {number} Cell edge length of the coarsest body in the scene. */
    coarsestCell() {
        return this.simBodies.reduce((coarsest, { lattice }) => Math.max(coarsest, lattice.h), 0);
    }

    /**
     * Pins a node to a world position for dragging.
     *
     * @param {number} bodyIndex - Index into the body list, or -1 to release.
     * @param {number} localNodeIndex - Node index within that body.
     */
    setGrab(bodyIndex, localNodeIndex) {
        if (bodyIndex < 0 || localNodeIndex < 0) {
            this.grab.body = -1;
            this.grab.node = -1;
            this.particles.setGrab(-1, -1);
            return;
        }
        this.grab.body = bodyIndex;
        this.grab.node = this.particles.offsetOf(bodyIndex) + localNodeIndex;
        this.particles.setGrab(bodyIndex, this.grab.node);
    }

    /**
     * @param {number[]} position - World position to drag the grabbed node to.
     */
    setGrabTarget(position) {
        this.grab.target = position;
    }

    /** Returns every body to its rest state, at rest. */
    reset() {
        this.setGrab(-1, -1);
        this.particles.reset();
        this.stepCount = 0;
    }

    destroy() {
        this.stepper.destroy();
        this.contact.destroy();
        this.elastic.destroy();
        this.particles.destroy();
    }
}
