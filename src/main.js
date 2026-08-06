import { WebGpuUnavailableError, createApp } from './scene/app.js';
import { createBodies } from './scene/contents.js';
import { createStage } from './scene/stage.js';
import { TANK_BOUNDS, createTank } from './scene/tank.js';
import { createLatticeDebug } from './render/latticeDebug.js';
import { Simulator } from './sim/simulator.js';

const canvas = document.getElementById('app');

async function boot() {
    const app = await createApp(canvas);

    createStage(app);
    createTank(app);

    const bodies = await createBodies();
    const sim = new Simulator(app.graphicsDevice, bodies, TANK_BOUNDS);
    const pacing = sim.autoSubsteps();

    bodies.forEach((body, index) => {
        app.root.addChild(createLatticeDebug(app, body.lattice, sim.nodePositions, sim.nodeOffset(index)));
    });

    // The dispatch has to be recorded inside the render frame, so it hangs off
    // the app update rather than a timer of its own.
    app.on('update', dt => sim.step(dt));

    app.start();

    const totals = bodies.reduce(
        (acc, body) => ({ cells: acc.cells + body.cellCount, nodes: acc.nodes + body.nodeCount }),
        { cells: 0, nodes: 0 }
    );
    console.info(
        `[softbody] device=${app.graphicsDevice.deviceType} bodies=${bodies.length} ` +
        `cells=${totals.cells} tets=${totals.cells * 6} nodes=${totals.nodes} ` +
        `substeps=${pacing.applied} (advised ${pacing.advised}) cfl=${pacing.cfl.toFixed(2)} ` +
        `limited by "${sim.worstBody().name}"`
    );
    for (const body of bodies) {
        const { gamma } = body.solverConstants;
        console.info(`[softbody]   ${body.name}: h=${body.lattice.h.toFixed(4)}m cells=${body.cellCount} gamma=${gamma.toFixed(3)}`);
    }
    if (pacing.cfl >= 1) {
        console.warn(
            `[softbody] CFL ${pacing.cfl.toFixed(2)} >= 1: the deviatoric constraint will be ` +
            'projected hard and bodies will collapse. Soften the material, enlarge the cells, ' +
            'or raise params.maxSubsteps.'
        );
    }

    // Handy while there is no UI yet.
    Object.assign(window, { app, sim, bodies });
    return app;
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
