import { discretizeBody, relumpMasses } from './discretize/discretize.js';
import { SimArena } from './solver/arena.js';
import { elementCompliance, waveRatio } from './solver/compliance.js';
import { SimKernels } from './solver/kernels.js';

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

        this.arena = new SimArena(device, this.simBodies);
        this.kernels = new SimKernels(device, this.arena);

        this.grab = { body: -1, node: -1, target: [0, 0, 0] };
        this.stepCount = 0;
    }

    /** @returns {import('playcanvas').StorageBuffer} Live node positions, for the debug view. */
    get nodePositions() {
        return this.arena.nodePos;
    }

    /**
     * @param {number} bodyIndex - Index into the body list.
     * @returns {number} Where that body's nodes start in the shared arrays.
     */
    nodeOffset(bodyIndex) {
        return this.arena.nodeOffsets[bodyIndex];
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
            cells: this.arena.cellCount,
            tets: this.arena.cellCount * 6,
            nodes: this.arena.nodeCount,
            substeps: this.params.substeps,
            advised: this.recommendedSubsteps(frameTime),
            cfl: this.cflNumber(frameTime),
            limitedBy: this.worst().body.name,
            perBody: this.simBodies.map(({ body, lattice }) => ({
                name: body.name,
                h: lattice.h,
                cells: lattice.cells.length,
                gamma: elementCompliance(body.material, lattice).gamma
            }))
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
        if (this.params.paused) {
            return;
        }
        this.advance(Math.min(dt, this.params.maxFrameTime));
    }

    /**
     * Advances by exactly one frame regardless of the paused flag, for
     * single-stepping from the UI.
     *
     * @param {number} [dt] - Frame duration in seconds.
     */
    stepOnce(dt = 1 / 60) {
        this.advance(dt);
    }

    /**
     * @param {number} dt - Frame duration in seconds.
     */
    advance(dt) {
        const { substeps, gravity } = this.params;
        if (dt <= 0 || substeps < 1) {
            return;
        }

        this.kernels.setFrameParameters({
            substepDt: dt / substeps,
            gravity,
            tankMin: this.tank.min,
            tankMax: this.tank.max,
            grabTarget: this.grab.target
        });

        this.device.computeDispatch(this.kernels.sequence(substeps), 'softbody-step');
        this.stepCount += substeps;
    }

    /**
     * Applies a material change. Everything except density is a handful of
     * uniforms; density also has to re-lump the node masses, because those are
     * a property of the discretisation rather than of the material.
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
            this.arena.uploadMasses();
        }
        this.arena.uploadBodies();
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
            this.arena.setGrab(-1, -1);
            return;
        }
        this.grab.body = bodyIndex;
        this.grab.node = this.arena.nodeOffsets[bodyIndex] + localNodeIndex;
        this.arena.setGrab(bodyIndex, this.grab.node);
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
        this.arena.reset();
        this.stepCount = 0;
    }

    destroy() {
        this.kernels.destroy();
        this.arena.destroy();
    }
}
