import { attachGrabber } from './ui/grab.js';
import { createMeshView } from './render/mesh.js';
import { createPanel } from './ui/panel.js';
import { createSplatView } from './render/splats.js';
import { createStage } from './scene/stage.js';
import { sceneNamed } from './scene/scenes.js';
import { WebGpuUnavailableError, createApp } from './scene/app.js';
import { createLatticeView } from './sim/debug/latticeView.js';
import { Simulator } from './sim/simulator.js';

const canvas = document.getElementById('app');

async function boot() {
    const scene = sceneNamed(new URLSearchParams(window.location.search).get('scene'));
    const app = await createApp(canvas);

    const { camera } = createStage(app, scene.bounds);
    scene.decorate(app);

    // Drawn but not stepped: the parts of a capture that are only ever backdrop.
    const scenery = await (scene.scenery?.() ?? []);
    for (const capture of scenery) {
        app.root.addChild(createSplatView(app, capture.name, capture.cloud));
    }

    const bodies = await scene.createBodies();

    // Every capture says what it measured, simulated or not, because which way
    // up it is and how big it is were declared by hand and a declaration nobody
    // checks is a guess.
    for (const { report } of [...scenery, ...bodies.map(body => body.source)]) {
        if (report) {
            console.info(`[splats] ${report}`);
        }
    }

    const sim = new Simulator(app.graphicsDevice, bodies, scene.bounds);

    // Two ways of looking at the same deformation: the surface, and the solver's
    // own insides. The second starts hidden -- it is what you turn on when the
    // first looks wrong.
    const latticeViews = sim.simBodies.map(({ body, lattice }, index) => {
        const field = sim.deformationOf(index);
        drawBody(app, body, field);

        const view = createLatticeView(app, lattice, field);
        view.enabled = false;
        app.root.addChild(view);
        return view;
    });

    const panel = createPanel(sim, {
        onLatticeToggle: (visible) => {
            for (const view of latticeViews) {
                view.enabled = visible;
            }
        }
    });
    document.body.append(panel.element);
    attachGrabber(app, camera, sim);

    // The dispatch has to be recorded inside the render frame, so it hangs off
    // the app update rather than a timer of its own.
    app.on('update', (dt) => {
        sim.step(dt);
        panel.update(dt);
    });

    app.start();

    report(scene.name, sim.stats());

    // Handy from the console; the panel covers everything routine.
    Object.assign(window, { app, sim, scene, bodies, latticeViews });
    return app;
}

/**
 * How each kind of render geometry becomes an entity.
 *
 * A table rather than a chain of conditionals, for the same reason
 * `sim/discretize/discretize.js`'s `VOXELIZERS` is one: the number of entries is
 * what grows, so a new representation should mean adding a line here rather than
 * editing a branch. This is still the one place the two render paths are told
 * apart -- it is assembly rather than a decision, since both take the same
 * deformation field and neither knows the other exists.
 *
 * @type {Record<string, (app: import('playcanvas').AppBase,
 *   body: import('./body/softBody.js').SoftBody,
 *   field: import('./deformation/bind.js').DeformationField) => import('playcanvas').Entity>}
 */
const VIEWS = {
    mesh: (app, body, field) => createMeshView(app, body.render.mesh, field, { tint: body.tint }),
    splats: (app, body, field) => createSplatView(app, body.name, body.render.cloud, field)
};

/**
 * Puts a body on screen with whichever representation it brought.
 *
 * @param {import('playcanvas').AppBase} app - The application.
 * @param {import('./body/softBody.js').SoftBody} body - The body to draw.
 * @param {import('./deformation/bind.js').DeformationField} field - Its deformation.
 */
function drawBody(app, body, field) {
    const kind = body.render?.kind;
    const createView = VIEWS[kind];
    if (!createView) {
        throw new Error(`no render path for a body of render kind "${kind}"`);
    }
    app.root.addChild(createView(app, body, field));
}

/**
 * @param {string} name - Which scene is being shown.
 * @param {ReturnType<import('./sim/simulator.js').Simulator['stats']>} stats - Setup report.
 */
function report(name, stats) {
    console.info(
        `[softbody] scene=${name} device=${stats.deviceType} bodies=${stats.bodyCount} ` +
        `cells=${stats.cells} tets=${stats.tets} nodes=${stats.nodes} ` +
        `step=${(stats.stepDuration * 1000).toFixed(3)}ms cfl=${stats.cfl.toFixed(2)} ` +
        `maxSteps/frame=${stats.maxStepsPerFrame} ` +
        `limited by "${stats.limitedBy}"`
    );
    for (const body of stats.perBody) {
        console.info(
            `[softbody]   ${body.name}: h=${body.h.toFixed(4)}m cells=${body.cells} ` +
            `gamma=${body.gamma.toFixed(3)} collapses below ${(body.collapseScale * 100).toFixed(0)}%`
        );
    }
    if (stats.cfl >= 1) {
        console.warn(
            `[softbody] CFL ${stats.cfl.toFixed(2)} >= 1: the deviatoric constraint will be ` +
            'projected hard and bodies will collapse. The fixed timestep failed its invariant.'
        );
    }
}

boot().catch((err) => {
    if (err instanceof WebGpuUnavailableError) {
        canvas.style.display = 'none';
        document.getElementById('unsupported').style.display = 'flex';
        console.error(`[softbody] ${err.message}`);
        return;
    }
    throw err;
});
