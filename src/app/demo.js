import { createMeshView } from '../render/mesh.js';
import { createSplatView, destroySplatView } from '../render/splats.js';
import { createApp } from '../scene/app.js';
import { sceneNamed } from '../scene/scenes.js';
import { createStage } from '../scene/stage.js';
import { createLatticeView } from '../sim/debug/latticeView.js';
import { Simulator } from '../sim/simulator.js';
import { attachGrabber } from '../ui/grab.js';
import { createPanel } from '../ui/panel.js';

const DEFAULT_DEPS = {
    attachGrabber,
    createEngine: createApp,
    createLatticeView,
    createMeshView,
    createPanel,
    createSplatView,
    destroySplatView,
    createStage,
    sceneNamed,
    Simulator
};

/** Every declared render geometry has one application-level assembly path. */
const VIEWS = {
    mesh: (owner, body, field) => owner.deps.createMeshView(owner.engine, body.render.mesh, field, { tint: body.tint }),
    splats: (owner, body, field) => owner.createOwnedSplatView(body.name, body.render.cloud, field)
};

/** Existing mesh, 3DGS and mixed demonstrations as one owned application session. */
export class DemoApplication {
    constructor({ canvas, sceneName = null, host = document.body, browser = window, deps = {} }) {
        this.canvas = canvas;
        this.sceneName = sceneName;
        this.host = host;
        this.browser = browser;
        this.deps = { ...DEFAULT_DEPS, ...deps };
        this.phase = 'idle';
        this.engine = null;
        this.scene = null;
        this.bodies = [];
        this.sim = null;
        this.panel = null;
        this.grabber = null;
        this.latticeViews = [];
        this.splatViews = [];
        this.latticeVisible = false;
        this.listeners = new Set();
        this.startPromise = null;
        this.generation = 0;
        this.onUpdate = dt => this.update(dt);
        this.onPageHide = () => this.destroy();
    }

    /** Starts once; concurrent or repeated calls share the same session. */
    start() {
        if (this.phase === 'running') return Promise.resolve(this);
        if (this.phase === 'starting') return this.startPromise;
        if (this.phase === 'destroyed') return Promise.reject(new Error('cannot restart a destroyed application'));
        const generation = ++this.generation;
        this.phase = 'starting';
        this.notify();
        this.startPromise = this.assemble(generation).then(() => {
            this.assertCurrent(generation);
            this.phase = 'running';
            this.notify();
            return this;
        }).catch((error) => {
            this.cleanup();
            if (this.phase !== 'destroyed') this.phase = 'failed';
            this.startPromise = null;
            this.notify();
            throw error;
        });
        return this.startPromise;
    }

    /** Builds the selected legacy demonstration behind the application boundary. */
    async assemble(generation) {
        const d = this.deps;
        this.scene = d.sceneNamed(this.sceneName);
        this.engine = await d.createEngine(this.canvas);
        this.assertCurrent(generation);
        const { camera } = d.createStage(this.engine, this.scene.bounds);
        this.scene.decorate(this.engine);

        const scenery = await (this.scene.scenery?.() ?? []);
        this.assertCurrent(generation);
        for (const capture of scenery) {
            this.engine.root.addChild(this.createOwnedSplatView(capture.name, capture.cloud));
        }
        this.bodies = await this.scene.createBodies();
        this.assertCurrent(generation);
        this.reportCaptures(scenery);
        this.sim = new d.Simulator(this.engine.graphicsDevice, this.bodies, this.scene.bounds);

        this.latticeViews = this.sim.simBodies.map(({ body, lattice }, index) => {
            const field = this.sim.deformationOf(index);
            this.drawBody(body, field);
            const view = d.createLatticeView(this.engine, lattice, field);
            view.enabled = false;
            this.engine.root.addChild(view);
            return view;
        });

        this.panel = d.createPanel(() => this.state(), this.actions());
        this.host.append(this.panel.element);
        this.grabber = d.attachGrabber(this.engine, camera, this);
        this.engine.on('update', this.onUpdate);
        this.browser.addEventListener('pagehide', this.onPageHide);
        this.engine.start();
        report(this.scene.name, this.sim.stats());
        Object.assign(this.browser, {
            app: this.engine,
            sim: this.sim,
            scene: this.scene,
            bodies: this.bodies,
            latticeViews: this.latticeViews
        });
    }

    /** Public operations passed to UI code; none expose simulation buffers. */
    actions() {
        return {
            setPaused: paused => this.setPaused(paused),
            requestStep: () => this.run(sim => sim.requestStep()),
            reset: () => this.run(sim => sim.reset()),
            setMaterial: (index, patch) => this.run(sim => sim.setMaterial(index, patch)),
            setContact: enabled => this.run(sim => sim.setContact(enabled)),
            setDriveLaw: law => this.run(sim => sim.setDriveLaw(law)),
            setGrip: strategy => this.run(sim => sim.setGrip(strategy)),
            setGripRadius: radius => this.run(sim => sim.setGripRadius(radius)),
            setLatticeVisible: visible => this.setLatticeVisible(visible)
        };
    }

    /** Observable application state, copied away from mutable body descriptions. */
    state() {
        return {
            phase: this.phase,
            sceneName: this.scene?.name ?? this.sceneName,
            paused: this.sim?.params.paused ?? true,
            latticeVisible: this.latticeVisible,
            bodies: this.sim?.simBodies.map(({ body }) => ({
                name: body.name,
                material: { ...body.material }
            })) ?? [],
            simulation: this.sim?.stats() ?? null
        };
    }

    subscribe(listener) {
        this.listeners.add(listener);
        try {
            listener(this.state());
        } catch (error) {
            this.listeners.delete(listener);
            throw error;
        }
        return () => this.listeners.delete(listener);
    }

    notify() {
        if (this.listeners.size === 0) return;
        const state = this.state();
        for (const listener of this.listeners) {
            try {
                listener(state);
            } catch (error) {
                this.listeners.delete(listener);
                console.error('[softbody] application observer failed', error);
            }
        }
    }

    run(operation) {
        if (this.phase !== 'running' || !this.sim) throw new Error('application is not running');
        const result = operation(this.sim);
        this.notify();
        return result;
    }

    setPaused(paused) {
        this.run(sim => { sim.params.paused = Boolean(paused); });
    }

    setLatticeVisible(visible) {
        const enabled = Boolean(visible);
        for (const view of this.latticeViews) view.enabled = enabled;
        this.latticeVisible = enabled;
        this.notify();
    }

    get tank() { return this.sim?.tank; }
    grab(origin, direction) { return this.run(sim => sim.grab(origin, direction)); }
    moveGrab(position) { return this.run(sim => sim.moveGrab(position)); }
    releaseGrab() { if (this.sim) this.sim.releaseGrab(); }

    /** The sole frame callback for the session. */
    update(dt) {
        if (this.phase !== 'running') return;
        this.sim.step(dt);
        this.panel.update(dt);
        this.notify();
    }

    /** Ends the session once and releases every resource it created. */
    destroy() {
        if (this.phase === 'destroyed') return;
        ++this.generation;
        this.cleanup();
        this.phase = 'destroyed';
        this.startPromise = null;
        try {
            this.notify();
        } finally {
            this.listeners.clear();
        }
    }

    assertCurrent(generation) {
        if (generation !== this.generation || this.phase === 'destroyed') {
            throw new Error('application session ended during startup');
        }
    }

    cleanup() {
        this.browser.removeEventListener('pagehide', this.onPageHide);
        if (this.engine) this.engine.off('update', this.onUpdate);
        this.grabber?.detach();
        this.sim?.destroy();
        this.panel?.element.remove();
        this.clearDebugReferences();
        for (const view of this.splatViews) this.deps.destroySplatView(view);
        this.splatViews = [];
        this.engine?.destroy();
        this.engine = null;
        this.scene = null;
        this.bodies = [];
        this.sim = null;
        this.panel = null;
        this.grabber = null;
        this.latticeViews = [];
        this.latticeVisible = false;
    }

    clearDebugReferences() {
        const owned = {
            application: this,
            app: this.engine,
            sim: this.sim,
            scene: this.scene,
            bodies: this.bodies,
            latticeViews: this.latticeViews
        };
        for (const [key, value] of Object.entries(owned)) {
            if (this.browser[key] === value) delete this.browser[key];
        }
    }

    reportCaptures(scenery) {
        for (const { report: message } of [...scenery, ...this.bodies.map(body => body.source)]) {
            if (message) console.info(`[splats] ${message}`);
        }
    }

    drawBody(body, field) {
        const create = VIEWS[body.render?.kind];
        if (!create) throw new Error(`no render path for a body of render kind "${body.render?.kind}"`);
        this.engine.root.addChild(create(this, body, field));
    }

    createOwnedSplatView(name, cloud, field = null) {
        const view = this.deps.createSplatView(this.engine, name, cloud, field);
        this.splatViews.push(view);
        return view;
    }
}

function report(name, stats) {
    console.info(
        `[softbody] scene=${name} device=${stats.deviceType} bodies=${stats.bodyCount} ` +
        `cells=${stats.cells} tets=${stats.tets} nodes=${stats.nodes} ` +
        `step=${(stats.stepDuration * 1000).toFixed(3)}ms cfl=${stats.cfl.toFixed(2)} ` +
        `maxSteps/frame=${stats.maxStepsPerFrame} limited by "${stats.limitedBy}"`
    );
    for (const body of stats.perBody) {
        console.info(
            `[softbody]   ${body.name}: h=${body.h.toFixed(4)}m cells=${body.cells} ` +
            `gamma=${body.gamma.toFixed(3)} collapses below ${(body.collapseScale * 100).toFixed(0)}%`
        );
    }
    if (stats.cfl >= 1) {
        console.warn(`[softbody] CFL ${stats.cfl.toFixed(2)} >= 1: the fixed timestep failed its invariant.`);
    }
}
