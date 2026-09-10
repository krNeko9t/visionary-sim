import { Mat4, Vec3 } from 'playcanvas';
import { benchBody } from '../body/bench.prototype.js';
import { createLatticeView } from '../sim/debug/latticeView.js';
import { Simulator } from '../sim/simulator.js';

/**
 * One fixed, rotated container and the instances that have been joined to it.
 *
 * The container's pose is read once, here, and never again: everything after
 * this point solves in its rest frame, so a member added later lands in the
 * same frame as the first one without re-deriving anything. The UI is what
 * enforces that by refusing container edits while a session exists.
 *
 * Joining is two-phase on purpose. `prepare` builds and binds everything that
 * can fail while the running members keep running and keep rendering off the
 * buffers they already hold; `commit` is the one moment anything switches, and
 * it re-reads every existing member's field synchronously because the commit
 * destroyed the buffers those fields pointed at. No hot-add rebuild: a member
 * already being simulated never returns to its rest shape because another one
 * joined.
 *
 * @param {import('playcanvas').AppBase} app - The application.
 * @param {import('playcanvas').Entity} world - Global correction transform.
 * @param {import('playcanvas').Entity} container - The tank, in world space.
 * @param {{ bind: (member: object) => () => void }} hooks - How a member's view is
 *   attached to its deformation. Passed in rather than imported: `scene/` may not
 *   reach `render/`, and this is the seam that keeps that true.
 */
export function createBenchSimulation(app, world, container, { bind }) {
    const frame = new Mat4().setTRS(container.getPosition(), container.getRotation(), Vec3.ONE);
    const inverse = frame.clone().invert();
    const scale = world.getLocalScale().x;
    const size = container.getLocalScale().clone().mulScalar(scale);
    const half = [size.x / 2, size.y / 2, size.z / 2];
    const bounds = { min: half.map(v => -v), max: half, closedTop: true };

    // The tank as an axis-aligned world-space box, for the pointer. Corners of
    // the rotated interior rather than the interior itself: a grabber clamps a
    // target it computed in world space, before anything transforms it back.
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < 8; i++) {
        const p = frame.transformPoint(new Vec3(...half.map((v, k) => i & (1 << k) ? v : -v)));
        [p.x, p.y, p.z].forEach((v, k) => { min[k] = Math.min(min[k], v); max[k] = Math.max(max[k], v); });
    }

    const m = frame.data;
    const origin = [m[12], m[13], m[14]];
    const rotation = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
    const array = v => [v.x, v.y, v.z];

    /** @type {Simulator|null} Created by the first member, destroyed with the session. */
    let sim = null;
    /** @type {{ view: object, index: number, field: object, unbind: () => void }[]} */
    const members = [];
    let epoch = 0, alive = true;

    function bodyOf(view) {
        const transform = new Mat4().mul2(inverse, world.getWorldTransform());
        const spin = container.getRotation().clone().invert().mul(world.getRotation());
        return benchBody(view, transform.data, [spin.x, spin.y, spin.z, spin.w], scale);
    }

    /** Whatever a member's hand size should be now that the finest lattice may have changed. */
    function retune() {
        sim.grip.radius = Math.max(sim.finestCell() * 1.5, 0.0001);
    }

    /**
     * The solver's own insides, on demand.
     *
     * Built only while someone is looking, and thrown away and rebuilt whenever
     * an append replaces the node buffers -- exactly like a member's surface
     * binding, and for exactly the same reason. Not built during `prepare`: a
     * debug picture is not worth compiling against buffers that may be
     * discarded, and its shaders are outside the caller's error scope.
     *
     * @type {import('playcanvas').Entity[]}
     */
    let latticeViews = [];
    let latticeVisible = false;

    function clearLattice() {
        for (const entity of latticeViews) {
            const instances = [...(entity.render?.meshInstances ?? [])];
            entity.destroy();
            for (const instance of instances) {
                instance.mesh.destroy();
                instance.material.destroy();
            }
        }
        latticeViews = [];
    }

    function buildLattice() {
        clearLattice();
        if (!latticeVisible || !sim) return;
        for (const member of members) {
            const entity = createLatticeView(
                app, sim.simBodies[member.index].lattice, sim.deformationOf(member.index),
                { origin, rotation }
            );
            app.root.addChild(entity);
            latticeViews.push(entity);
        }
    }

    const grabber = {
        tank: { min, max },
        /** Makes any grab still in flight land on nothing. */
        invalidate() { epoch++; if (sim) sim.releaseGrab(); },
        async grab(ray, direction) {
            if (!sim) return null;
            const attempt = ++epoch;
            try {
                const hit = await sim.grab(
                    array(inverse.transformPoint(new Vec3(...ray))),
                    array(inverse.transformVector(new Vec3(...direction)))
                );
                if (!alive || attempt !== epoch) {
                    if (alive && sim) sim.releaseGrab();
                    return null;
                }
                return hit ? { ...hit, position: array(frame.transformPoint(new Vec3(...hit.position))) } : null;
            } catch (error) {
                if (alive) throw error;
                return null;
            }
        },
        moveGrab(position) {
            if (!sim) return;
            const p = array(inverse.transformPoint(new Vec3(...position)));
            sim.moveGrab(p.map((v, k) => Math.max(bounds.min[k], Math.min(bounds.max[k], v))));
        },
        releaseGrab() { epoch++; if (alive && sim) sim.releaseGrab(); }
    };

    /**
     * Attaches a member's view to a field, replacing whatever it was bound to.
     *
     * @param {object} member - The member to bind.
     * @param {object} field - Its deformation in this container's frame.
     */
    function attach(member, field) {
        member.field = field;
        member.origin = origin;
        member.rotation = rotation;
        member.unbind = bind(member);
    }

    return {
        members,
        grabber,
        get sim() { return sim; },
        has(view) { return members.some(member => member.view === view); },

        /**
         * Everything that can fail about joining `view`, done while the members
         * already running are untouched.
         *
         * The returned candidate must be settled exactly once. `commit` is the
         * only moment existing members change what they read, and it does the
         * re-attaching itself so no frame can be drawn against a destroyed
         * buffer.
         *
         * @param {object} view - The instance to join.
         * @returns {Promise<{ member: object, commit: () => object, cancel: () => void }>}
         */
        async prepare(view) {
            grabber.invalidate();
            const body = bodyOf(view);

            // The first member is a construction, every later one an append.
            // Not unified: an empty simulator would have to allocate
            // zero-length buffers before there is anything to put in them.
            if (!sim) {
                const created = new Simulator(app.graphicsDevice, [body], bounds);
                const gravity = inverse.transformVector(new Vec3(0, -9.81, 0));
                created.params.gravity = [gravity.x, gravity.y, gravity.z];
                created.params.paused = true;
                const member = { view, index: 0 };
                try {
                    attach(member, created.deformationOf(0));
                } catch (error) {
                    created.destroy();
                    throw error;
                }
                return {
                    member,
                    commit() {
                        sim = created;
                        retune();
                        members.push(member);
                        buildLattice();
                        return member;
                    },
                    cancel() {
                        member.unbind?.();
                        created.destroy();
                    }
                };
            }

            const candidate = await sim.prepareAppend(body);
            const member = { view, index: candidate.bodyIndex };
            try {
                attach(member, candidate.deformationOf(candidate.bodyIndex));
            } catch (error) {
                candidate.cancel();
                throw error;
            }
            return {
                member,
                commit() {
                    candidate.commit();
                    // The swap destroyed the buffers every existing member's
                    // field named. Re-read and re-apply before returning, so
                    // there is no frame in between.
                    for (const existing of members) {
                        existing.unbind();
                        attach(existing, sim.deformationOf(existing.index));
                    }
                    retune();
                    members.push(member);
                    buildLattice();
                    return member;
                },
                cancel() {
                    member.unbind?.();
                    candidate.cancel();
                }
            };
        },

        get latticeVisible() { return latticeVisible; },

        /**
         * Shows or hides one wireframe cell per occupied lattice cell, tinted by
         * parallel-solve colour group, following the live node positions.
         *
         * @param {boolean} visible - Whether to draw the lattice.
         */
        setLatticeVisible(visible) {
            latticeVisible = visible;
            buildLattice();
        },

        /**
         * How the solver actually cut one member up.
         *
         * @param {object} view - The instance to report on.
         * @returns {{ cells: number, h: number }|null} Cell count and cell edge
         *   length in metres, or nothing if `view` is not a member.
         */
        latticeOf(view) {
            const member = members.find(entry => entry.view === view);
            if (!member || !sim) return null;
            const { cells, h } = sim.simBodies[member.index].lattice;
            return { cells: cells.length, h };
        },

        /**
         * @param {object} view - Whose material changed. Ignored if not a member.
         */
        updateMaterial(view) {
            const member = members.find(entry => entry.view === view);
            if (!member) return;
            const { rho_si, E_si, nu_si } = view.physics;
            sim.setMaterial(member.index, {
                density: rho_si, youngsModulus: E_si, poissonRatio: nu_si
            });
        },

        destroy() {
            grabber.releaseGrab();
            alive = false;
            clearLattice();
            for (const member of members) member.unbind();
            members.length = 0;
            sim?.destroy();
            sim = null;
        }
    };
}
