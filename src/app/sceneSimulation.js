import { createSplatView, destroySplatView } from '../render/splats.js';
import { Simulator } from '../sim/simulator.js';
import { attachGrabber } from '../ui/grab.js';
import { createGpuCandidate } from './gpuCandidate.js';
import { createSimulationPreparationTask } from './simulationWorkerClient.js';

const DEFAULT_RESOLUTION = 16;

/**
 * Prepare one whole simulation replacement without changing the published scene.
 * CPU candidates live in Workers; GPU objects and deforming views stay disabled
 * until a scoped render-frame probe succeeds.
 */
export async function createSceneSimulationCandidate({
    app, camera, canvas, ownership, onError, scene, reference, calibration, container,
    participantIds, materials, previousRuntime = null, signal, onProgress = () => {},
    resolution = DEFAULT_RESOLUTION
}, deps = {}) {
    const d = {
        createPreparationTask: createSimulationPreparationTask,
        createGpuCandidate,
        createSplatView,
        destroySplatView,
        attachGrabber,
        Simulator,
        ...deps
    };
    if (!app?.graphicsDevice || !scene?.prepared?.groups || !scene?.views?.groups) {
        throw new Error('scene simulation needs a published scene and graphics device');
    }

    const sourceGroups = new Map(scene.prepared.groups.map(group => [group.id, group]));
    const visibleGroups = new Map(scene.views.groups.map(group => [group.id, group]));
    const tasks = [];
    const abort = () => tasks.forEach(task => task.cancel());
    signal?.addEventListener('abort', abort, { once: true });
    try {
        for (const id of participantIds) {
            const instance = sourceGroups.get(id);
            if (!instance || !visibleGroups.has(id)) throw new Error(`unknown scene instance ${id}`);
            const material = requireMaterial(materials, id);
            if (previousRuntime?.hasParticipant(id)) continue;
            const task = d.createPreparationTask({
                // Color and SH arrays stay on the render owner; the Worker only
                // needs geometry and must not clone dozens of unused channels.
                instance: { id, name: instance.name, cloud: simulationCloud(instance.cloud) },
                reference,
                calibration,
                material,
                resolution
            }, progress => onProgress({ ...progress, instanceId: id }));
            tasks.push(task);
        }
        if (signal?.aborted) throw cancellation();
        const prepared = await Promise.all(tasks.map(task => task.promise));
        if (signal?.aborted) throw cancellation();

        const bundle = await d.createGpuCandidate({
            graphicsDevice: app.graphicsDevice,
            signal,
            create: () => createBundle({
                app, scene, prepared, participantIds, sourceGroups, visibleGroups,
                container, previousRuntime, deps: d
            }),
            validate: candidate => probeCandidateFrame(app, candidate, signal)
        });
        let transferred = false;
        return {
            async publish({ materials: latestMaterials, signal: publishSignal = signal, readMaterials }) {
                if (transferred) throw new Error('simulation candidate was already published');
                if (publishSignal?.aborted) throw cancellation();
                // Final migration/reset and the latest material uploads can
                // themselves fail asynchronously on WebGPU. Keep a fresh pair
                // of scopes around them and wait for the queue before changing
                // which representation is visible.
                let uploaded = snapshotMaterials(participantIds, latestMaterials);
                for (;;) {
                    await d.createGpuCandidate({
                        graphicsDevice: app.graphicsDevice,
                        signal: publishSignal,
                        create: () => bundle,
                        validate: () => {
                            if (previousRuntime) previousRuntime.simulator.restoreAppendCandidate(bundle.sim);
                            else bundle.sim.reset();
                            bundle.sim.syncCandidateMaterials(participantIds.map(id => ({
                                bodyId: id, material: uploaded[id]
                            })));
                            app.graphicsDevice.submit();
                        }
                    });
                    if (publishSignal?.aborted) throw cancellation();
                    if (!readMaterials) break;
                    // UI edits remain enabled during queue/error-scope waits.
                    // Re-read after the wait and revalidate any changed snapshot.
                    // A synchronous application read introduces no new gap before
                    // the final synchronous view switch. Invalid values reject.
                    const pending = readMaterials();
                    const current = snapshotMaterials(participantIds,
                        pending && typeof pending.then === 'function' ? await pending : pending);
                    if (sameMaterials(participantIds, uploaded, current)) break;
                    uploaded = current;
                }
                if (publishSignal?.aborted) throw cancellation();
                const runtime = publishBundle(bundle, {
                    app, camera, canvas, ownership, onError, attachGrabber: d.attachGrabber,
                    destroySplatView: d.destroySplatView, previousRuntime
                });
                transferred = true;
                return runtime;
            },
            discard() {
                if (transferred) return;
                bundle.destroy();
            }
        };
    } finally {
        signal?.removeEventListener('abort', abort);
    }
}

function createBundle({
    app, scene, prepared, participantIds, sourceGroups, visibleGroups,
    container, previousRuntime, deps
}) {
    let sim = null;
    const replacements = [];
    let destroyed = false;
    try {
        const additions = prepared.map(entry => ({ ...entry, id: entry.instanceId }));
        sim = previousRuntime
            ? previousRuntime.simulator.createAppendCandidate(additions)
            : new deps.Simulator(app.graphicsDevice, additions, container);
        for (const id of participantIds) {
            const bodyIndex = sim.bodyIndexOf(id);
            if (bodyIndex < 0) throw new Error(`candidate simulation is missing instance ${id}`);
            const source = sourceGroups.get(id);
            const visible = visibleGroups.get(id);
            const previousEntity = visible.entity;
            const sourceEntity = previousRuntime?.sourceEntityOf(id) ?? previousEntity;
            const dynamic = deps.createSplatView(
                app, `simulated-instance-${id}`, source.cloud, sim.deformationOf(bodyIndex),
                { twoDimensional: true }
            );
            dynamic.enabled = false;
            replacements.push({ id, visible, previousEntity, sourceEntity, dynamic });
            scene.views.root.addChild(dynamic);
        }
    } catch (error) {
        for (const { dynamic } of replacements) {
            try { deps.destroySplatView(dynamic); } catch {}
        }
        try { sim?.destroy(); } catch {}
        throw error;
    }
    return {
        sim,
        prepared,
        replacements,
        destroy() {
            if (destroyed) return;
            destroyed = true;
            let failure = null;
            for (const { dynamic } of replacements) {
                try { deps.destroySplatView(dynamic); } catch (error) { failure ??= error; }
            }
            try { sim.destroy(); } catch (error) { failure ??= error; }
            if (failure) throw failure;
        }
    };
}

/** Probe compute plus the real deformation shader while exactly one representation is visible. */
function probeCandidateFrame(app, bundle, signal) {
    return new Promise((resolve, reject) => {
        let swapped = false;
        let settled = false;
        const finish = (operation, value) => {
            if (settled) return;
            settled = true;
            app.off('update', update);
            app.off('frameend', frameEnd);
            signal?.removeEventListener('abort', cancel);
            restore();
            operation(value);
        };
        const restore = () => {
            if (!swapped) return;
            swapped = false;
            for (const { dynamic } of bundle.replacements) {
                dynamic.enabled = false;
                dynamic.gsplat.setParameter('deformationProbe', 0);
            }
        };
        const frameEnd = () => {
            finish(resolve);
        };
        const update = () => {
            app.off('update', update);
            try {
                for (const { dynamic } of bundle.replacements) {
                    // Exercise the real workbuffer/deformation shader while
                    // remaining transparent. The published source and picker
                    // identity stay untouched until every scope has passed.
                    dynamic.gsplat.setParameter('deformationProbe', 1);
                    dynamic.enabled = true;
                }
                swapped = true;
                bundle.sim.params.paused = true;
                bundle.sim.requestStep();
                bundle.sim.step(0);
                app.on('frameend', frameEnd);
            } catch (error) {
                finish(reject, error);
            }
        };
        const cancel = () => finish(reject, cancellation());
        if (signal?.aborted) {
            finish(reject, cancellation());
            return;
        }
        signal?.addEventListener('abort', cancel, { once: true });
        app.on('update', update);
    });
}

function publishBundle(bundle, { app, camera, ownership, onError, attachGrabber, previousRuntime }) {
    const { sim, replacements } = bundle;
    let active = true;
    let paused = false;
    let grabbingEnabled = true;
    let grabber = null;
    const clockListeners = new Set();
    const notifyClock = () => {
        const clock = sim.stats().simulatedTime;
        for (const listener of clockListeners) listener(clock);
    };
    const update = dt => {
        if (!active) return;
        sim.step(dt);
        notifyClock();
    };
    const enableGrab = () => {
        if (grabbingEnabled && !grabber && camera && ownership) {
            grabber = attachGrabber(app, camera, sim, { ownership, owner: 'grab', onError });
        }
    };
    const disableGrab = () => {
        const current = grabber;
        grabber = null;
        let failure = null;
        try { current?.detach(); } catch (error) { failure = error; }
        try { sim.releaseGrab(); } catch (error) { failure ??= error; }
        if (failure) throw failure;
    };
    const restoreSource = () => {
        let failure = null;
        for (const { visible, sourceEntity, dynamic } of replacements) {
            try {
                dynamic.enabled = false;
                sourceEntity.enabled = true;
                visible.entity = sourceEntity;
            } catch (error) { failure ??= error; }
        }
        if (failure) throw failure;
    };
    const restorePrevious = () => {
        let failure = null;
        for (const { visible, previousEntity, dynamic } of replacements) {
            try {
                dynamic.enabled = false;
                previousEntity.enabled = true;
                visible.entity = previousEntity;
            } catch (error) { failure ??= error; }
        }
        if (failure) throw failure;
    };
    try {
        for (const { visible, previousEntity, dynamic } of replacements) {
            previousEntity.enabled = false;
            dynamic.gsplat.setParameter('deformationProbe', 0);
            dynamic.enabled = true;
            visible.entity = dynamic;
        }
        sim.resumeAfterAppend();
        app.on('update', update);
        enableGrab();
    } catch (error) {
        try { app.off('update', update); } catch {}
        try { disableGrab(); } catch {}
        try { restorePrevious(); } catch {}
        try { bundle.destroy(); } catch {}
        throw error;
    }

    // All candidate views and bindings are live before the old shared buffers
    // are released. Cleanup failure cannot safely roll back to resources that
    // may already have been partly destroyed, so the valid new runtime wins.
    try {
        previousRuntime?.releaseForReplacement();
    } catch (error) {
        console.error('[scene-simulation] replaced runtime cleanup failed', error);
    }

    const close = (restore = true) => {
        if (!active) return;
        active = false;
        let failure = null;
        try { app.off('update', update); } catch (error) { failure ??= error; }
        try { disableGrab(); } catch (error) { failure ??= error; }
        if (restore) {
            try { restoreSource(); } catch (error) { failure ??= error; }
        }
        clockListeners.clear();
        try { bundle.destroy(); } catch (error) { failure ??= error; }
        if (failure) throw failure;
    };
    return Object.freeze({
        get simulator() { return sim; },
        hasParticipant: instanceId => sim.bodyIndexOf(instanceId) >= 0,
        sourceEntityOf(instanceId) {
            return replacements.find(entry => entry.id === instanceId)?.sourceEntity ?? null;
        },
        get metrics() {
            return Object.freeze(replacements.map(({ id }) => Object.freeze({
                instanceId: id, ...sim.metricsOf(id)
            })));
        },
        getClock: () => sim.stats().simulatedTime,
        getTiming() {
            const stats = sim.stats();
            return Object.freeze({
                simulatedTime: stats.simulatedTime,
                backlogTime: stats.backlogTime,
                frameDroppedTime: stats.frameDroppedTime,
                droppedTime: stats.droppedTime,
                overloaded: stats.overloaded,
                maxStepsPerFrame: stats.maxStepsPerFrame
            });
        },
        subscribeClock(listener) {
            clockListeners.add(listener);
            listener(sim.stats().simulatedTime);
            return () => clockListeners.delete(listener);
        },
        setMaterial(instanceId, material) {
            const index = sim.bodyIndexOf(instanceId);
            if (index < 0) return false;
            sim.setMaterial(index, requireMaterial({ [instanceId]: material }, instanceId));
            return true;
        },
        getGrabbing: () => active && !paused && grabbingEnabled,
        setGrabbing(enabled) {
            if (typeof enabled !== 'boolean') throw new TypeError('grabbing requires a boolean');
            if (!active || paused) throw new Error('grabbing can only be changed while running');
            const previous = grabbingEnabled;
            grabbingEnabled = enabled;
            try {
                if (enabled) enableGrab();
                else disableGrab();
            } catch (error) {
                grabbingEnabled = previous;
                throw error;
            }
        },
        async freeze() {
            if (!active || paused) return;
            try {
                disableGrab();
                await sim.freezeForAppend();
                paused = true;
            } catch (error) {
                // freezeForAppend closes the gate before submitting/draining.
                // Roll every local and simulator gate back if that drain fails,
                // so the caller's still-running observable phase stays true.
                try { sim.resumeAfterAppend(); } catch {}
                try { enableGrab(); } catch {}
                throw error;
            }
        },
        async resume() {
            if (!active || !paused) return;
            paused = false;
            sim.resumeAfterAppend();
            enableGrab();
        },
        releaseForReplacement() { close(false); },
        async returnToPreparation() { close(); },
        async dispose() { close(); }
    });
}

function requireMaterial(materials, id) {
    const material = materials?.[id] ?? materials?.get?.(id);
    if (!material || !Number.isFinite(material.density) || material.density <= 0 ||
        !Number.isFinite(material.youngsModulus) || material.youngsModulus <= 0 ||
        !Number.isFinite(material.poissonRatio)) {
        throw new Error(`instance ${id} has invalid latest material`);
    }
    return material;
}

function simulationCloud(cloud) {
    return {
        count: cloud.count,
        dimensionality: cloud.dimensionality,
        positions: cloud.positions,
        rotations: cloud.rotations,
        scales: cloud.scales
    };
}

function cancellation() {
    const error = new Error('simulation preparation was cancelled');
    error.name = 'AbortError';
    return error;
}

function snapshotMaterials(ids, materials) {
    return Object.fromEntries(ids.map(id => [id, { ...requireMaterial(materials, id) }]));
}

function sameMaterials(ids, left, right) {
    return ids.every(id => {
        const keys = new Set([...Object.keys(left[id]), ...Object.keys(right[id])]);
        return [...keys].every(key => Object.is(left[id][key], right[id][key]));
    });
}
