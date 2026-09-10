import { bodyOfNode, nearestNodeToRay } from './pick.js';
import { DEFAULT_GRAB_RADIUS, GRIPS, limitGripTarget, worstCaseHeldNodes } from './grip.js';
import { latticeField } from '../deformation/bind.js';
import { discretizeBody, relumpMasses } from './discretize/discretize.js';
import { BodyContact } from './constraints/bodyContact.js';
import { ElasticCells } from './constraints/elasticCells.js';
import { KinematicDrive } from './constraints/kinematicDrive.js';
import { Particles } from './state/particles.js';
import { Stepper } from './solver/stepper.js';
import { containerWorldBounds, solverContainerFrame } from './solver/container.js';
import { FixedTimestep, stableStepDuration } from './solver/timestep.js';
import { collapseScale, elementCompliance, waveRatio } from './constraints/compliance.js';
import {
    freezeForAppend,
    isolateCandidateBodies,
    migrateFrozenState,
    syncCandidateMaterials
} from './append.js';

/**
 * The simulation's only public surface.
 *
 * Everything outside `sim/` talks to this object: the scene hands it bodies,
 * the UI changes materials, {@link grab} holds a node for the pointer.
 * Nothing outside touches a buffer, a kernel or a dispatch -- and nothing
 * outside decides how a body is cut up, which is this object's first act.
 *
 * @typedef {object} SimBody
 * @property {string|number} id - Opaque stable identity across shared-state replacement.
 * @property {import('../body/softBody.js').SoftBody} body - What the author described.
 * @property {import('./discretize/lattice.js').Lattice} lattice - How this simulator chose
 *   to discretise it. The seam between the two is exactly this pairing.
 */

const DEFAULT_PARAMS = {
    gravity: [0, -9.81, 0],
    paused: false
};

let nextBodyId = 1;
const allocateBodyId = () => `simulation-body:${nextBodyId++}`;

function simulationBody(entry) {
    if (entry?.body && entry?.lattice) {
        return { ...entry, id: entry.id ?? entry.bodyId ?? allocateBodyId() };
    }
    return { id: allocateBodyId(), body: entry, lattice: discretizeBody(entry) };
}

export class Simulator {
    /**
     * @param {import('playcanvas').GraphicsDevice} device - WebGPU device.
     * @param {(import('../body/softBody.js').SoftBody|SimBody)[]} bodies - Bodies or CPU-prepared bodies.
     * @param {object} container - Scene container, or legacy tank bounds.
     */
    constructor(device, bodies, container) {
        if (!device.supportsCompute) {
            throw new Error('Simulator requires a device with compute support');
        }
        this.device = device;
        this.tank = container;
        this.containerFrame = solverContainerFrame(container);
        this.params = { ...DEFAULT_PARAMS };
        /** Prevents frame and manual-step dispatch while a replacement is prepared. */
        this.appendFrozen = false;
        /** Invalidates asynchronous pick readbacks when a grab ends or the simulator dies. */
        this.grabEpoch = 0;
        this.alive = true;

        /** @type {SimBody[]} */
        this.simBodies = bodies.map(simulationBody);
        const bodyIds = new Set(this.simBodies.map(({ id }) => id));
        if (bodyIds.size !== this.simBodies.length) {
            throw new Error('Simulator body IDs must be unique');
        }

        // The three pieces of the simulation side, assembled here and nowhere
        // else. They are listed in dependency order and each knows only the one
        // before it: the nodes exist, constraints move them, a stepper runs the
        // constraints. The stepper never learns what kind of constraint it is
        // running, which is what left room for a second kind, and now a third:
        // nodes that are not solved for, but told.
        // Spelled out rather than handing the lattice over whole: these three
        // arrays are the entire set of things the node storage is allowed to
        // know, and writing them at the seam is what keeps that visible.
        try {
            this.particles = new Particles(device, this.simBodies.map(({ lattice }) => ({
                restPositions: lattice.restPositions,
                invMass: lattice.invMass,
                nodeCount: lattice.nodeCount
            })));
            this.drive = new KinematicDrive(device, this.particles);
            this.elastic = new ElasticCells(device, this.particles, this.simBodies.map(
                ({ body, lattice }) => ({ lattice, material: body.material })
            ));
            this.contact = new BodyContact(
                device, this.particles, this.simBodies.map(({ lattice }) => ({ lattice })),
                containerWorldBounds(this.containerFrame)
            );
            // Order is solve order. Driven nodes go first: under the hard law
            // nothing else can move them anyway, and this is what lets the
            // compliant law's nudge still be shaped by elasticity and contact
            // afterwards, in the same substep. Contact goes last of the other two
            // so it has the final word on where a node may be: elasticity can push
            // a node back into whatever it was resting on, and only one of the two
            // is allowed to be wrong about that.
            this.stepper = new Stepper(device, this.particles, [this.drive, this.elastic, this.contact]);

            // Render frames decide when GPU work may be recorded, but not how much
            // physical time one solve represents. The clock turns their irregular
            // dt into a count of fixed stable steps and knows nothing about the
            // dispatches that will execute them; this class is their only seam.
            this.clock = new FixedTimestep(stableStepDuration(this.waveRate()));

            for (let b = 0; b < this.simBodies.length; b++) {
                const { damping, friction } = this.simBodies[b].body.material;
                this.particles.setParams(b, { damping, friction });
            }
        } catch (error) {
            try { this.destroy(); } catch {}
            throw error;
        }

        // Where the handle is, and where it was last frame -- the only two
        // numbers `dispatch` needs to hand `this.drive` a velocity for this
        // frame's substeps. `previousTarget` only advances when a dispatch
        // actually runs, so a frame with nothing to simulate never loses the
        // motion in between.
        this.handle = { target: [0, 0, 0], previousTarget: [0, 0, 0] };
        /**
         * Which nodes a grab holds, and how big a hand `withinRadius` uses.
         * `withinRadius` is the default: `singleNode` is what "拖哪里都很重，
         * 点阵越密越重" was describing, kept only because a switchable strategy
         * needs both a control and a fallback arm, same reasoning as keeping
         * the compliant drive law alongside the hard one.
         */
        this.grip = { strategy: 'withinRadius', radius: DEFAULT_GRAB_RADIUS };
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
        return latticeField({
            nodePositions: this.particles.nodePos,
            origin: lattice.origin,
            h: lattice.h,
            cellDims: lattice.cellDims,
            nodeDims: lattice.nodeDims,
            nodeOffset: this.particles.offsetOf(bodyIndex)
        });
    }

    /** Opaque stable identity for one current body. */
    bodyIdAt(bodyIndex) {
        return this.simBodies[bodyIndex]?.id ?? null;
    }

    /** Resolves an opaque body identity only at the simulator boundary. */
    bodyIndexOf(bodyId) {
        return this.simBodies.findIndex(entry => entry.id === bodyId);
    }

    /**
     * Current discretization metrics, copied without exposing simulation storage.
     * Query again after material edits or shared-state replacement.
     *
     * @param {string|number} bodyId - Opaque stable body identity, not an array index.
     * @returns {{volume:number,mass:number,nodes:number,occupiedCells:number,resolution:number}|null}
     *   Current values, or null when the body is not in this simulator.
     */
    metricsOf(bodyId) {
        const entry = this.simBodies[this.bodyIndexOf(bodyId)];
        if (!entry) return null;
        const { body, lattice } = entry;
        return Object.freeze({
            volume: lattice.volume,
            mass: lattice.mass,
            nodes: lattice.nodeCount,
            occupiedCells: lattice.cells.length,
            resolution: body.resolution
        });
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
     * @returns {number} The CFL number; keep it below 1.
     */
    cflNumber() {
        return this.waveRate() * this.clock.stepDuration;
    }

    /**
     * The body whose wave-speed-to-cell-size ratio is setting the substep
     * requirement for the whole scene.
     *
     * Every stability query goes through this one reduction, so there is a
     * single definition of "which body is the problem".
     *
     * @returns {SimBody|null} The limiting body, or null if there are none.
     */
    worst() {
        // A scene can be all backdrop: rendered captures that nothing steps.
        // Then no body sets the substep requirement, and the honest answer is
        // that there is no answer rather than the first element of an empty
        // reduction.
        if (this.simBodies.length === 0) {
            return null;
        }
        return this.simBodies.reduce((worst, entry) =>
            (waveRatio(entry.body.material, entry.lattice) >
             waveRatio(worst.body.material, worst.lattice) ? entry : worst));
    }

    /**
     * Fastest elastic wave in cell crossings per second.
     *
     * Kept next to {@link worst} so the material/discretisation reduction has
     * one definition whether the clock is configured or the UI is reporting it.
     *
     * @returns {number} Scene stability rate, or zero with no bodies.
     */
    waveRate() {
        const limiting = this.worst();
        return limiting ? waveRatio(limiting.body.material, limiting.lattice) : 0;
    }

    /**
     * Everything worth reporting about the current setup, so that callers can
     * print or display it without reaching into the arena or the lattices.
     *
     * @returns {object} A flat report.
     */
    stats() {
        const timing = this.clock.snapshot();
        return {
            deviceType: this.device.deviceType,
            bodyCount: this.simBodies.length,
            cells: this.elastic.cellCount,
            tets: this.elastic.cellCount * 6,
            nodes: this.particles.nodeCount,
            contactNodes: this.contact.surfaceCount,
            contact: this.contact.enabled,
            steps: timing.steps,
            stepDuration: timing.stepDuration,
            maxStepsPerFrame: timing.maxStepsPerFrame,
            simulatedTime: timing.simulatedTime,
            backlogTime: timing.backlogTime,
            frameDroppedTime: timing.frameDroppedTime,
            droppedTime: timing.droppedTime,
            overloaded: timing.overloaded,
            cfl: this.cflNumber(),
            limitedBy: this.worst()?.body.name ?? 'nothing',
            grip: {
                strategy: this.grip.strategy,
                radius: this.grip.radius,
                worstCase: worstCaseHeldNodes(this.grip.radius, this.finestCell()),
                capacity: this.drive.capacity
            },
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
        // Append freezes at a complete step boundary. Unlike ordinary pause,
        // frames during preparation must not even rewrite the clock's last
        // report: the candidate clones the exact frozen accounting later.
        if (this.appendFrozen) {
            this.pendingStep = false;
            return;
        }
        // A scene can be all backdrop, and a solver with no degrees of freedom
        // has neither work nor physical time to advance. Said here rather than
        // left to the kernels: they would bind zero-length buffers and fail
        // validation every frame.
        if (this.particles.nodeCount === 0) {
            this.pendingStep = false;
            this.clock.idle();
            return;
        }

        // `dt` is the one input here that can arrive from outside the render
        // loop (`window.sim.step(...)` from the console; see main.js). Garbage
        // is treated as a frame carrying no elapsed time rather than left to
        // throw through FixedTimestep's stricter internal contract, which
        // exists to catch bugs in this class's own bookkeeping, not to police
        // console input.
        const elapsed = Number.isFinite(dt) && dt >= 0 ? dt : 0;

        const pendingStep = this.pendingStep;
        this.pendingStep = false;

        let timing;
        if (this.params.paused) {
            if (!pendingStep) {
                this.clock.idle();
                return;
            }
            timing = this.clock.singleStep();
        } else {
            // A pending request while running still has to go through the
            // ordinary accumulator so this frame's wall time is banked,
            // dropped or simulated exactly as it would be without the
            // request -- `forceStep` only guarantees a step happens even if
            // the accumulator alone would not have produced one.
            timing = this.clock.consume(elapsed, { forceStep: pendingStep });
        }

        this.dispatch(timing.steps);
    }

    /**
     * Asks for exactly one fixed physical step, paused or not.
     *
     * Deferred rather than run here, because a dispatch is only legal inside
     * the render frame and the thing that wants a single step is a button
     * click. Keeping that rule inside this class is the point: no caller should
     * have to know when a dispatch may be recorded.
     */
    requestStep() {
        if (this.appendFrozen) return;
        this.pendingStep = true;
    }

    /** Freezes interaction and waits until every previously submitted GPU step is complete. */
    async freezeForAppend() {
        await freezeForAppend(this);
    }

    /**
     * Builds an unpublished shared Simulator and migrates every existing body.
     * The returned Simulator owns all candidate resources. On construction or
     * migration failure those resources are released here; the old Simulator
     * remains alive and frozen.
     *
     * @param {SimBody[]} additions - CPU-prepared bodies not in this Simulator.
     * @returns {Simulator} Candidate common simulation.
     */
    createAppendCandidate(additions) {
        if (!this.appendFrozen || !this.params.paused) {
            throw new Error('freeze the simulator before creating an append candidate');
        }
        let candidate = null;
        try {
            const bodies = isolateCandidateBodies([...this.simBodies, ...additions]);
            candidate = new this.constructor(this.device, bodies, this.tank);
            migrateFrozenState(this, candidate);
            return candidate;
        } catch (error) {
            try { candidate?.destroy(); } catch {}
            throw error;
        }
    }

    /** Reestablishes a candidate after its real GPU validation probe. */
    restoreAppendCandidate(candidate) {
        if (!this.appendFrozen || !this.params.paused) {
            throw new Error('previous simulator is no longer frozen for append');
        }
        return migrateFrozenState(this, candidate);
    }

    /** Forces one validated latest-material snapshot into this candidate. */
    syncCandidateMaterials(updates) {
        syncCandidateMaterials(this, updates);
    }

    /** Leaves the append gate and resumes future render-frame accounting. */
    resumeAfterAppend() {
        if (!this.alive) throw new Error('cannot resume a disposed simulator');
        this.pendingStep = false;
        this.appendFrozen = false;
        this.params.paused = false;
    }

    /**
     * @param {number} steps - Number of fixed physical steps to dispatch.
     */
    dispatch(steps) {
        if (steps < 1) {
            return;
        }

        this.stepper.setFrameParameters({
            substepDt: this.clock.stepDuration,
            gravity: this.params.gravity,
            containerFrame: this.containerFrame
        });

        // The handle's velocity this frame, not read off any input device:
        // just how far its target moved since last frame's dispatch, divided
        // among this frame's substeps. Skipped while nothing is held, so an
        // idle scene never pays for it and `previousTarget` never drifts away
        // from `target` in between holds.
        if (this.drive.drivenCount > 0) {
            const { target, previousTarget } = this.handle;
            const frameDt = steps * this.clock.stepDuration;
            this.drive.setHandle(target, [0, 1, 2].map(axis =>
                (target[axis] - previousTarget[axis]) / frameDt));
            this.handle.previousTarget = target;
        }

        this.device.computeDispatch(this.stepper.sequence(steps), 'softbody-step');
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
        // Stiffness and density change the wave rate. The fractional backlog is
        // kept as seconds by the clock; only all future physical steps change.
        this.clock.setStepDuration(stableStepDuration(this.waveRate()));
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
     * What a line through the scene hits, holding it if it hit something.
     *
     * Asynchronous because the answer lives on the GPU. That is a property of
     * where the simulation runs, not an accident: the caller has to be willing
     * to learn what it hit a frame after asking. Which node the ray hit is
     * only the anchor: `this.grip.strategy` turns that anchor into the actual
     * held set {@link KinematicDrive} drives, and {@link moveGrab} moves it
     * from there.
     *
     * @param {number[]} origin - Ray origin in world space.
     * @param {number[]} direction - Unit ray direction.
     * @returns {Promise<{ bodyIndex: number, position: number[] }|null>}
     *   Which body was hit and where, or null if the ray missed everything.
     */
    async grab(origin, direction) {
        const epoch = ++this.grabEpoch;
        let nodes;
        try {
            nodes = await this.particles.readPositions();
        } catch (error) {
            // Destroying particle buffers may reject a readback that no longer
            // has a caller. Failures from a live attempt still surface.
            if (!this.alive || epoch !== this.grabEpoch) return null;
            throw error;
        }
        if (!this.alive || epoch !== this.grabEpoch) {
            return null;
        }
        // A little over the coarsest cell, so that anything visibly over a
        // body has a node within reach. This is aim tolerance, not hand size:
        // it stays a lattice property on purpose, see `sim/grip.js`.
        const aimRadius = this.coarsestCell() * 1.2;
        const anchor = nearestNodeToRay(nodes, this.particles.invMass, origin, direction, aimRadius);
        if (anchor < 0) {
            return null;
        }

        const grip = GRIPS[this.grip.strategy](nodes, this.particles.invMass, anchor, {
            radius: this.grip.radius,
            nodeOffsets: this.particles.offsets,
            limit: this.drive.capacity
        });
        if (grip.found > grip.nodes.length) {
            console.warn(
                `[grip] ${grip.found} nodes within ${this.grip.radius} m, only the nearest ` +
                `${grip.nodes.length} held -- this grab's extent is resolution-dependent again.`
            );
        }

        const position = [nodes[anchor * 4], nodes[anchor * 4 + 1], nodes[anchor * 4 + 2]];
        this.drive.hold(grip.nodes, grip.offsets);
        this.handle.target = position;
        this.handle.previousTarget = position;

        return { bodyIndex: bodyOfNode(this.particles.offsets, anchor), position, held: grip.nodes.length };
    }

    /** @returns {number} Cell edge length of the coarsest body in the scene, widest aim tolerance. */
    coarsestCell() {
        return this.simBodies.reduce((coarsest, { lattice }) => Math.max(coarsest, lattice.h), 0);
    }

    /**
     * @returns {number} Cell edge length of the finest body in the scene --
     *   the one a fixed-radius hand can hold the most nodes of, used to warn
     *   before {@link grab} might need to truncate a hold.
     */
    finestCell() {
        return this.simBodies.reduce(
            (finest, { lattice }) => Math.min(finest, lattice.h), Infinity
        );
    }

    /**
     * Switches which nodes a grab holds once it finds an anchor.
     *
     * @param {keyof typeof GRIPS} strategy - `'singleNode'` or `'withinRadius'`.
     */
    setGrip(strategy) {
        if (!GRIPS[strategy]) {
            throw new Error(`[grip] unknown strategy "${strategy}"`);
        }
        this.grip.strategy = strategy;
    }

    /**
     * @param {number} radius - World-space hand radius for `withinRadius`, metres.
     */
    setGripRadius(radius) {
        this.grip.radius = radius;
    }

    /**
     * Moves the handle {@link grab} attached to a world position.
     *
     * @param {number[]} position - World position to move the handle to.
     */
    moveGrab(position) {
        this.handle.target = limitGripTarget(position, this.containerFrame);
    }

    /** Releases whatever {@link grab} is currently holding. */
    releaseGrab() {
        ++this.grabEpoch;
        if (this.alive) this.drive?.release();
    }

    /**
     * Switches how a held node is driven toward the handle.
     *
     * @param {import('./constraints/kinematicDrive.js').DriveLaw} law - The drive law.
     */
    setDriveLaw(law) {
        this.drive.law = law;
    }

    /** Returns every body to its rest state, at rest. */
    reset() {
        this.releaseGrab();
        this.particles.reset();
        this.clock.reset();
        this.pendingStep = false;
    }

    destroy() {
        if (!this.alive) return;
        let failure = null;
        try { this.releaseGrab(); } catch (error) { failure = error; }
        this.alive = false;
        for (const resource of [this.stepper, this.contact, this.elastic, this.drive, this.particles]) {
            if (!resource) continue;
            try { resource.destroy(); } catch (error) { failure ??= error; }
        }
        if (failure) throw failure;
    }
}
