import { bodyOfNode, nearestNodeToRay } from './pick.js';
import { DEFAULT_GRIPPED_PART_RADIUS, GRIPS, worstCaseHeldNodes } from './grip.js';
import { discretizeBody, elasticConstraints } from './discretize/discretize.js';
import { BodyContact } from './constraints/bodyContact.js';
import { KinematicDrive } from './constraints/kinematicDrive.js';
import { Particles } from './state/particles.js';
import { Stepper } from './solver/stepper.js';
import { FixedTimestep, stableStepDuration } from './solver/timestep.js';
import { collapseScale, gammaOf, waveRatio } from './constraints/compliance.js';

/**
 * The simulation's only public surface.
 *
 * Everything outside `sim/` talks to this object: the scene hands it bodies,
 * the UI changes materials, {@link grab} holds a node for the pointer.
 * Nothing outside touches a buffer, a kernel or a dispatch -- and nothing
 * outside decides how a body is cut up, which is this object's first act.
 *
 * @typedef {object} SimBody
 * @property {import('../body/softBody.js').SoftBody} body - What the author described.
 * @property {import('./discretize/proxyGeometry.js').ProxyGeometry} proxy - How this
 *   simulator chose to discretise it. The seam between the two is exactly this pairing.
 */

const DEFAULT_PARAMS = {
    gravity: [0, -9.81, 0],
    paused: false
};

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
        this.simBodies = bodies.map(body => ({ body, proxy: discretizeBody(body) }));

        // The three pieces of the simulation side, assembled here and nowhere
        // else. They are listed in dependency order and each knows only the one
        // before it: the nodes exist, constraints move them, a stepper runs the
        // constraints. The stepper never learns what kind of constraint it is
        // running, which is what left room for a second kind, and now a third:
        // nodes that are not solved for, but told.
        // `dof` rather than the whole proxy: these three arrays are the entire
        // set of things the node storage is allowed to know.
        this.particles = new Particles(device, this.simBodies.map(({ proxy }) => proxy.dof));
        this.drive = new KinematicDrive(device, this.particles);
        // Elasticity is the discretisation's to build (ADR-0007): what an
        // element is and how elements are batched is how the body was cut up.
        this.elasticSets = elasticConstraints(
            device,
            this.particles,
            this.simBodies.map(({ proxy }) => proxy),
            this.simBodies.map(({ body }) => body.material)
        );
        this.contact = new BodyContact(device, this.particles, this.simBodies.map(({ proxy }) => proxy), tank);
        // Order is solve order. Driven nodes go first: under the hard law
        // nothing else can move them anyway, and this is what lets the
        // compliant law's nudge still be shaped by elasticity and contact
        // afterwards, in the same substep. Contact goes last of the other two
        // so it has the final word on where a node may be: elasticity can push
        // a node back into whatever it was resting on, and only one of the two
        // is allowed to be wrong about that.
        this.stepper = new Stepper(device, this.particles, [this.drive, ...this.elasticSets, this.contact]);

        // Render frames decide when GPU work may be recorded, but not how much
        // physical time one solve represents. The clock turns their irregular
        // dt into a count of fixed stable steps and knows nothing about the
        // dispatches that will execute them; this class is their only seam.
        this.clock = new FixedTimestep(stableStepDuration(this.waveRate()));

        for (let b = 0; b < this.simBodies.length; b++) {
            const { damping, friction } = this.simBodies[b].body.material;
            this.particles.setParams(b, { damping, friction });
        }

        // Where the grab target is, and where it was last frame -- the only two
        // numbers `dispatch` needs to hand `this.drive` a velocity for this
        // frame's substeps. `previousPosition` only advances when a dispatch
        // actually runs, so a frame with nothing to simulate never loses the
        // motion in between.
        this.grabTarget = { position: [0, 0, 0], previousPosition: [0, 0, 0] };
        /**
         * Which nodes a grab holds, and how big a gripped part `withinRadius`
         * takes. `withinRadius` is the default: `singleNode` is what made a
         * drag feel heavier the finer the body was, kept only because a
         * switchable strategy needs both a control and a fallback arm, same
         * reasoning as keeping the compliant drive law alongside the hard one.
         */
        this.grip = { strategy: 'withinRadius', radius: DEFAULT_GRIPPED_PART_RADIUS };
        /** Set by {@link requestStep}, consumed by the next {@link step}. */
        this.pendingStep = false;
    }

    /**
     * How one body's deformation is handed to anything that wants to be carried
     * by it.
     *
     * This is the whole of the simulation's output. It says where the solver's
     * degrees of freedom currently are and how to read them, and nothing about
     * how the body was cut up or what constrains it -- so a render path can
     * consume it without ever learning what the proxy geometry is. Everything
     * that draws something goes through here, including the wireframe of the
     * proxy itself.
     *
     * @param {number} bodyIndex - Index into the body list.
     * @returns {import('../deformation/bind.js').DeformationField} Its deformation.
     */
    deformationOf(bodyIndex) {
        const { proxy } = this.simBodies[bodyIndex];
        return proxy.field(this.particles.nodePos, this.particles.offsetOf(bodyIndex));
    }

    /**
     * How far an elastic wave travels in one substep, as a fraction of its
     * body's `cflLength`, for whichever body has the tightest ratio.
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
     * The body whose ratio of wave speed to `cflLength` is setting the substep
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
            (waveRatio(entry.body.material, entry.proxy.cflLength) >
             waveRatio(worst.body.material, worst.proxy.cflLength) ? entry : worst));
    }

    /**
     * Fastest elastic wave, in `cflLength` crossings per second.
     *
     * Kept next to {@link worst} so the material/discretisation reduction has
     * one definition whether the clock is configured or the UI is reporting it.
     *
     * @returns {number} Scene stability rate, or zero with no bodies.
     */
    waveRate() {
        const limiting = this.worst();
        return limiting ? waveRatio(limiting.body.material, limiting.proxy.cflLength) : 0;
    }

    /**
     * Everything worth reporting about the current setup, so that callers can
     * print or display it without reaching into the arena or the proxies.
     *
     * @returns {object} A flat report.
     */
    stats() {
        const timing = this.clock.snapshot();
        return {
            deviceType: this.device.deviceType,
            bodyCount: this.simBodies.length,
            scale: totalScale(this.simBodies.map(({ proxy }) => proxy.scale())),
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
                worstCase: worstCaseHeldNodes(this.grip.radius, this.finestSpacing()),
                capacity: this.drive.capacity
            },
            perBody: this.simBodies.map(({ body, proxy }) => {
                const gamma = gammaOf(body.material);
                return {
                    name: body.name,
                    spacing: proxy.spacing,
                    scale: proxy.scale(),
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
        this.pendingStep = true;
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
            tankMin: this.tank.min,
            tankMax: this.tank.max
        });

        // The grab target's velocity this frame, not read off any input
        // device: just how far it moved since last frame's dispatch, divided
        // among this frame's substeps. Skipped while nothing is held, so an
        // idle scene never pays for it and `previousPosition` never drifts away
        // from `position` in between holds.
        if (this.drive.drivenCount > 0) {
            const { position, previousPosition } = this.grabTarget;
            const frameDt = steps * this.clock.stepDuration;
            this.drive.setGrabTarget(position, [0, 1, 2].map(axis =>
                (position[axis] - previousPosition[axis]) / frameDt));
            this.grabTarget.previousPosition = position;
        }

        this.device.computeDispatch(this.stepper.sequence(steps), 'softbody-step');
    }

    /**
     * Applies a material change. Everything except density is a handful of
     * uniforms; density also has to rescale the node masses, because those are
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
        const { body, proxy } = this.simBodies[bodyIndex];
        const { density, ...rest } = changes;

        Object.assign(body.material, rest);
        if (density > 0 && density !== body.material.density) {
            proxy.setDensity(body.material.density, density);
            body.material.density = density;
            this.particles.uploadMasses();
        }
        this.particles.setParams(bodyIndex, {
            damping: body.material.damping,
            friction: body.material.friction
        });
        for (const elastic of this.elasticSets) {
            elastic.uploadParams();
        }
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
        const nodes = await this.particles.readPositions();
        // A little over the widest node spacing, so that anything visibly over
        // a body has a node within reach. This is aim tolerance, not hand size:
        // it stays a property of the discretisation on purpose, see `sim/grip.js`.
        const aimRadius = this.coarsestSpacing() * 1.2;
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
        this.grabTarget.position = position;
        this.grabTarget.previousPosition = position;

        return { bodyIndex: bodyOfNode(this.particles.offsets, anchor), position, held: grip.nodes.length };
    }

    /** @returns {number} Widest node spacing of any body in the scene, the aim tolerance's scale. */
    coarsestSpacing() {
        return this.simBodies.reduce((coarsest, { proxy }) => Math.max(coarsest, proxy.spacing.max), 0);
    }

    /**
     * @returns {number} Closest node spacing of any body in the scene -- the
     *   one a fixed-radius hand can hold the most nodes of, used to warn
     *   before {@link grab} might need to truncate a hold.
     */
    finestSpacing() {
        return this.simBodies.reduce(
            (finest, { proxy }) => Math.min(finest, proxy.spacing.min), Infinity
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
     * Moves the grab target of the current {@link grab} to a world position.
     *
     * @param {number[]} position - World position to move the grab target to.
     */
    moveGrab(position) {
        this.grabTarget.position = position;
    }

    /** Releases whatever {@link grab} is currently holding. */
    releaseGrab() {
        this.drive.release();
    }

    /**
     * Switches how a held node is driven toward the grab target.
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
        this.stepper.destroy();
        this.contact.destroy();
        for (const elastic of this.elasticSets) {
            elastic.destroy();
        }
        this.drive.destroy();
        this.particles.destroy();
    }
}

/**
 * Adds up the bodies' scales, keeping what was counted apart: a count of one
 * thing plus a count of another is not a number anyone can read.
 *
 * @param {import('./discretize/proxyGeometry.js').Scale[]} scales - One per body.
 * @returns {import('./discretize/proxyGeometry.js').Scale[]} One per distinct label, in first-seen order.
 */
function totalScale(scales) {
    const totals = new Map();
    for (const { label, value } of scales) {
        totals.set(label, (totals.get(label) ?? 0) + value);
    }
    return [...totals].map(([label, value]) => ({ label, value }));
}
