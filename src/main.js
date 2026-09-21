import { attachGrabber } from './ui/grab.js';
import { showLoadError } from './ui/loadError.js';
import { createPanel } from './ui/panel.js';
import { createSplatView } from './render/splats.js';
import { draw } from './render/draw.js';
import { createStage } from './scene/stage.js';
import { sceneNamed } from './scene/scenes.js';
import { WebGpuUnavailableError, createApp } from './scene/app.js';
import { Simulator } from './sim/simulator.js';

const canvas = document.getElementById('app');

async function boot() {
    const scene = sceneNamed(new URLSearchParams(window.location.search).get('scene'));
    await scene.prepare?.();
    const [bodies, scenery] = await Promise.all([
        scene.createBodies(), scene.scenery?.() ?? []
    ]);
    const app = await createApp(canvas);
    let sim;
    let simulationDestroyed = false;
    const destroySimulation = () => {
        if (simulationDestroyed) return;
        simulationDestroyed = true;
        sim?.destroy();
    };
    app.on('destroy', destroySimulation);
    try {
        sim = new Simulator(app.graphicsDevice, bodies, scene.bounds);
        scene.validateSimulation?.(sim.stats());
        if (scene.gravity !== undefined) sim.params.gravity = [...scene.gravity];
        // Nothing is displayed or stepped before scene-specific diagnostics pass.
        const { camera } = createStage(app, scene.viewBounds ?? scene.bounds, { focusBounds: scene.bounds });
        scene.decorate(app);
        for (const capture of scenery) {
            if (capture.cloud.count) {
                app.root.addChild(createSplatView(app, capture.name, capture.cloud));
            }
        }

        // Every capture says what it measured, simulated or not, because which way
        // up it is and how big it is were declared by hand and a declaration nobody
        // checks is a guess.
        for (const { report } of [...scenery, ...bodies.map(body => body.source)]) {
            if (report) {
                console.info(`[splats] ${report}`);
            }
        }

        // Two pieces of geometry carried by the same deformation: what the body
        // looks like, and the proxy's own wireframe. The second starts hidden -- it
        // is what you turn on when the first looks wrong.
        const wireframeViews = sim.simBodies.map(({ body, proxy }, index) => {
            const field = sim.deformationOf(index);
            if (body.render && (body.render.kind !== 'gaussians' || body.render.cloud.count)) {
                app.root.addChild(draw(app, body.render, field, { name: body.name, tint: body.tint }));
            }

            const view = draw(app, proxy.wireframe(), field, { name: body.name });
            view.enabled = false;
            app.root.addChild(view);
            return view;
        });

        const panel = createPanel(sim, {
            onProxyToggle: (visible) => {
                for (const view of wireframeViews) {
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
        Object.assign(window, { app, sim, scene, bodies, wireframeViews });
        return app;
    } catch (error) {
        destroySimulation();
        app.destroy();
        throw error;
    }
}

/**
 * @param {string} name - Which scene is being shown.
 * @param {ReturnType<import('./sim/simulator.js').Simulator['stats']>} stats - Setup report.
 */
function report(name, stats) {
    console.info(
        `[softbody] scene=${name} device=${stats.deviceType} bodies=${stats.bodyCount} ` +
        `${stats.scale.map(({ label, value }) => `${label}=${value}`).join(' ')} nodes=${stats.nodes} ` +
        `step=${(stats.stepDuration * 1000).toFixed(3)}ms cfl=${stats.cfl.toFixed(2)} ` +
        `maxSteps/frame=${stats.maxStepsPerFrame} ` +
        `limited by "${stats.limitedBy}"`
    );
    for (const body of stats.perBody) {
        console.info(
            `[softbody]   ${body.name}: spacing=${body.spacing.min.toFixed(4)}m ` +
            `${body.scale.label}=${body.scale.value} ` +
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

export const startup = boot().catch((err) => {
    if (err instanceof WebGpuUnavailableError) {
        canvas.style.display = 'none';
        document.getElementById('unsupported').style.display = 'flex';
        console.error(`[softbody] ${err.message}`);
        return;
    }
    showLoadError(canvas, err);
    console.error(`[softbody] ${err.message}`);
});
