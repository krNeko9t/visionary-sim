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

    // Drawn but not stepped. Each capture reports what it measured, because
    // which way up it is and how big it is were declared by hand and a
    // declaration nobody checks is a guess.
    for (const capture of await (scene.scenery?.() ?? [])) {
        console.info(`[splats] ${capture.report}`);
        app.root.addChild(createSplatView(app, capture.name, capture.cloud));
    }

    const bodies = await scene.createBodies();
    const sim = new Simulator(app.graphicsDevice, bodies, scene.bounds);
    sim.autoSubsteps();

    // Two ways of looking at the same deformation: the surface, and the solver's
    // own insides. The second starts hidden -- it is what you turn on when the
    // first looks wrong.
    const latticeViews = sim.simBodies.map(({ body, lattice }, index) => {
        const field = sim.deformationOf(index);

        if (body.renderMesh) {
            app.root.addChild(createMeshView(app, body.renderMesh, field, { tint: body.tint }));
        }

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
 * @param {string} name - Which scene is being shown.
 * @param {ReturnType<import('./sim/simulator.js').Simulator['stats']>} stats - Setup report.
 */
function report(name, stats) {
    console.info(
        `[softbody] scene=${name} device=${stats.deviceType} bodies=${stats.bodyCount} ` +
        `cells=${stats.cells} tets=${stats.tets} nodes=${stats.nodes} ` +
        `substeps=${stats.substeps} (advised ${stats.advised}) cfl=${stats.cfl.toFixed(2)} ` +
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
            'projected hard and bodies will collapse. Soften the material, enlarge the cells, ' +
            'or raise params.maxSubsteps.'
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
