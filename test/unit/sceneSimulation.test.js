import { describe, expect, it, vi } from 'vitest';

import { createSceneSimulationCandidate } from '../../src/app/sceneSimulation.js';
import { SimulationSession } from '../../src/app/simulationSession.js';

function emitter() {
    const listeners = new Map();
    return {
        graphicsDevice: { submit: vi.fn() },
        on(name, fn) { listeners.set(name, [...(listeners.get(name) ?? []), fn]); },
        off(name, fn) { listeners.set(name, (listeners.get(name) ?? []).filter(item => item !== fn)); },
        fire(name, value) { for (const fn of [...(listeners.get(name) ?? [])]) fn(value); },
        listenerCount(name) { return (listeners.get(name) ?? []).length; }
    };
}

function fixture() {
    const app = emitter();
    const sourceEntity = { enabled: true, gsplat: {} };
    const sourceGroup = { id: 7, name: 'sheet', cloud: { count: 1 } };
    const visible = { id: 7, entity: sourceEntity };
    const children = [];
    const scene = {
        prepared: { groups: [sourceGroup] },
        views: { groups: [visible], root: { addChild: child => children.push(child) } }
    };
    const dynamic = { enabled: true, gsplat: { setParameter: vi.fn() } };
    const simulator = {
        params: { paused: false },
        bodyIndexOf: vi.fn(id => id === 7 ? 0 : -1),
        metricsOf: vi.fn(() => ({ nodes: 1 })),
        setMaterial: vi.fn(), deformationOf: vi.fn(() => ({ shader: '', parameters: {} })),
        requestStep: vi.fn(), step: vi.fn(), reset: vi.fn(), syncCandidateMaterials: vi.fn(),
        freezeForAppend: vi.fn(async function () { this.params.paused = true; }),
        resumeAfterAppend: vi.fn(function () { this.params.paused = false; }),
        releaseGrab: vi.fn(), destroy: vi.fn(),
        stats: vi.fn(() => ({ simulatedTime: 1.25 }))
    };
    const grabbers = [];
    const deps = {
        createPreparationTask: vi.fn(input => ({
            promise: Promise.resolve({ instanceId: input.instance.id, body: {}, lattice: {} }),
            cancel: vi.fn()
        })),
        Simulator: class {
            constructor() { return simulator; }
        },
        createSplatView: vi.fn(() => dynamic),
        destroySplatView: vi.fn(),
        attachGrabber: vi.fn(() => {
            const value = { detach: vi.fn() };
            grabbers.push(value);
            return value;
        }),
        createGpuCandidate: vi.fn(async options => {
            const value = options.create();
            const probe = options.validate(value);
            app.fire('update', 0);
            expect(sourceEntity.enabled).toBe(true);
            expect(dynamic.gsplat.setParameter).toHaveBeenCalledWith('deformationProbe', 1);
            app.fire('frameend');
            await probe;
            return value;
        })
    };
    return { app, scene, sourceEntity, visible, dynamic, simulator, children, deps, grabbers };
}

const material = { density: 800, youngsModulus: 1e5, poissonRatio: 0.3 };

describe('scene simulation display candidate', () => {
    it('prepares off-scene, probes one unique representation, then publishes and restores atomically', async () => {
        const f = fixture();
        const ownership = { claim: vi.fn(() => true), release: vi.fn(), ownerOf: vi.fn(() => 'grab'), clear: vi.fn() };
        const candidate = await createSceneSimulationCandidate({
            app: f.app, camera: {}, ownership, scene: f.scene,
            reference: {}, calibration: {}, container: {}, participantIds: [7],
            materials: { 7: material }
        }, f.deps);

        expect(f.sourceEntity.enabled).toBe(true);
        expect(f.dynamic.enabled).toBe(false);
        expect(f.visible.entity).toBe(f.sourceEntity);
        expect(f.simulator.requestStep).toHaveBeenCalledOnce();
        expect(f.simulator.step).toHaveBeenCalledWith(0);
        expect(Object.keys(f.deps.createPreparationTask.mock.calls[0][0].instance.cloud))
            .toEqual(['count', 'dimensionality', 'positions', 'rotations', 'scales']);

        const latest = { ...material, density: 900 };
        const runtime = await candidate.publish({ materials: { 7: latest } });
        expect(f.app.graphicsDevice.submit).toHaveBeenCalledOnce();
        expect(f.deps.createGpuCandidate).toHaveBeenCalledTimes(2);
        expect(f.simulator.reset).toHaveBeenCalledOnce();
        expect(f.simulator.syncCandidateMaterials).toHaveBeenCalledWith([
            { bodyId: 7, material: latest }
        ]);
        expect(f.sourceEntity.enabled).toBe(false);
        expect(f.dynamic.enabled).toBe(true);
        expect(f.visible.entity).toBe(f.dynamic);
        expect(f.deps.attachGrabber).toHaveBeenCalledWith(f.app, {}, f.simulator,
            { ownership, owner: 'grab' });

        f.app.fire('update', 0.016);
        expect(f.simulator.step).toHaveBeenLastCalledWith(0.016);
        const clock = vi.fn();
        runtime.subscribeClock(clock);
        expect(clock).toHaveBeenCalledWith(1.25);

        await runtime.freeze();
        expect(f.simulator.params.paused).toBe(true);
        expect(f.simulator.freezeForAppend).toHaveBeenCalledOnce();
        expect(f.grabbers[0].detach).toHaveBeenCalledOnce();
        await runtime.resume();
        expect(f.simulator.params.paused).toBe(false);
        expect(f.simulator.resumeAfterAppend).toHaveBeenCalledTimes(2);
        expect(f.deps.attachGrabber).toHaveBeenCalledTimes(2);

        runtime.setMaterial(7, material);
        expect(f.simulator.setMaterial).toHaveBeenLastCalledWith(0, material);
        await runtime.returnToPreparation();
        expect(f.sourceEntity.enabled).toBe(true);
        expect(f.dynamic.enabled).toBe(false);
        expect(f.visible.entity).toBe(f.sourceEntity);
        expect(f.deps.destroySplatView).toHaveBeenCalledWith(f.dynamic);
        expect(f.simulator.destroy).toHaveBeenCalledOnce();
        expect(f.app.listenerCount('update')).toBe(0);
    });

    it('can disable grabbing without pausing and keeps that choice across pause/resume', async () => {
        const f = fixture();
        const session = new SimulationSession({
            preparation: { source: f.scene.prepared, transform: { scale: 1 }, calibration: {}, container: {} },
            participantIds: [7], readMaterials: () => ({ 7: material }),
            createCandidate: options => createSceneSimulationCandidate({
                ...options, app: f.app, scene: f.scene, camera: {}, ownership: {}, reference: {}
            }, f.deps)
        });
        await session.start();
        expect(f.deps.attachGrabber).toHaveBeenCalledOnce();
        await session.setGrabbing(false);
        expect(session.getState()).toMatchObject({ phase: 'running', grabbing: false });
        expect(f.grabbers[0].detach).toHaveBeenCalledOnce();
        expect(f.simulator.params.paused).toBe(false);
        await session.pause();
        await expect(session.setGrabbing(true)).rejects.toThrow(/while running/);
        await session.resume();
        expect(session.getState()).toMatchObject({ phase: 'running', grabbing: false });
        expect(f.deps.attachGrabber).toHaveBeenCalledOnce();
        await session.setGrabbing(true);
        expect(session.getState().grabbing).toBe(true);
        expect(f.deps.attachGrabber).toHaveBeenCalledTimes(2);
        await session.dispose();
    });

    it('reads current simulator metrics after publication and later density changes', async () => {
        const f = fixture();
        let density = 800;
        f.deps.createPreparationTask.mockImplementation(() => ({
            promise: Promise.resolve({ instanceId: 7, body: {}, lattice: {}, metrics: { volume: 0.01, mass: 8 } }),
            cancel: vi.fn()
        }));
        f.simulator.syncCandidateMaterials.mockImplementation(updates => { density = updates[0].material.density; });
        f.simulator.setMaterial.mockImplementation((index, update) => { density = update.density; });
        f.simulator.metricsOf.mockImplementation(id => id === 7 ? { volume: 0.01, mass: 0.01 * density } : null);
        const candidate = await createSceneSimulationCandidate({
            app: f.app, scene: f.scene, reference: {}, calibration: {}, container: {},
            participantIds: [7], materials: { 7: material }
        }, f.deps);
        const runtime = await candidate.publish({ materials: { 7: { ...material, density: 900 } } });
        expect(runtime.metrics).toEqual([{ instanceId: 7, volume: 0.01, mass: 9 }]);
        runtime.setMaterial(7, { ...material, density: 1600 });
        expect(runtime.metrics).toEqual([{ instanceId: 7, volume: 0.01, mass: 16 }]);
        await runtime.dispose();
    });

    it('keeps the source published when GPU preparation rejects', async () => {
        const f = fixture();
        f.deps.createGpuCandidate = async options => {
            const value = options.create();
            value.destroy();
            throw new Error('validation failed');
        };
        await expect(createSceneSimulationCandidate({
            app: f.app, scene: f.scene, reference: {}, calibration: {}, container: {},
            participantIds: [7], materials: { 7: material }
        }, f.deps)).rejects.toThrow('validation failed');
        expect(f.sourceEntity.enabled).toBe(true);
        expect(f.visible.entity).toBe(f.sourceEntity);
        expect(f.deps.destroySplatView).toHaveBeenCalledWith(f.dynamic);
        expect(f.simulator.destroy).toHaveBeenCalledOnce();
    });

    it('rolls back pause and grab gates when the GPU freeze drain rejects', async () => {
        const f = fixture();
        const candidate = await createSceneSimulationCandidate({
            app: f.app, camera: {}, ownership: {}, scene: f.scene,
            reference: {}, calibration: {}, container: {}, participantIds: [7],
            materials: { 7: material }
        }, f.deps);
        const runtime = await candidate.publish({ materials: { 7: material } });
        f.simulator.freezeForAppend.mockRejectedValueOnce(new Error('queue drain failed'));

        await expect(runtime.freeze()).rejects.toThrow('queue drain failed');
        expect(f.simulator.resumeAfterAppend).toHaveBeenCalledTimes(2);
        expect(f.deps.attachGrabber).toHaveBeenCalledTimes(2);

        f.simulator.freezeForAppend.mockResolvedValueOnce();
        await expect(runtime.freeze()).resolves.toBeUndefined();
        expect(f.simulator.freezeForAppend).toHaveBeenCalledTimes(2);
        await runtime.dispose();
    });

    it('appends through the frozen Simulator and replaces every shared binding atomically', async () => {
        const app = emitter();
        const source7 = { enabled: false, name: 'source-7' };
        const source12 = { enabled: true, name: 'source-12' };
        const oldDynamic7 = { enabled: true, name: 'old-dynamic-7' };
        const visible7 = { id: 7, entity: oldDynamic7 };
        const visible12 = { id: 12, entity: source12 };
        const scene = {
            prepared: { groups: [
                { id: 7, name: 'A', cloud: simulationCloud() },
                { id: 12, name: 'B', cloud: simulationCloud() }
            ] },
            views: {
                groups: [visible7, visible12],
                root: { addChild: vi.fn() }
            }
        };
        const nextDynamics = [
            { enabled: true, name: 'candidate-7', gsplat: { setParameter: vi.fn() } },
            { enabled: true, name: 'candidate-12', gsplat: { setParameter: vi.fn() } }
        ];
        const candidateSim = {
            params: { paused: true },
            bodyIndexOf: vi.fn(id => id === 7 ? 0 : id === 12 ? 1 : -1),
            metricsOf: vi.fn(id => ({ nodes: id === 7 ? 2 : 3 })),
            deformationOf: vi.fn(index => ({ shader: `field-${index}`, parameters: {} })),
            requestStep: vi.fn(), step: vi.fn(), reset: vi.fn(),
            syncCandidateMaterials: vi.fn(),
            resumeAfterAppend: vi.fn(function () { this.params.paused = false; }),
            freezeForAppend: vi.fn(async function () { this.params.paused = true; }),
            releaseGrab: vi.fn(), setMaterial: vi.fn(), destroy: vi.fn(),
            stats: vi.fn(() => ({ simulatedTime: 2 }))
        };
        const previousSim = {
            createAppendCandidate: vi.fn(() => candidateSim),
            restoreAppendCandidate: vi.fn()
        };
        const previousRuntime = {
            simulator: previousSim,
            metrics: Object.freeze([{ instanceId: 7, nodes: 2 }]),
            hasParticipant: vi.fn(id => id === 7),
            sourceEntityOf: vi.fn(id => id === 7 ? source7 : null),
            releaseForReplacement: vi.fn(() => {
                expect(visible7.entity).toBe(nextDynamics[0]);
                expect(visible12.entity).toBe(nextDynamics[1]);
                expect(nextDynamics.every(entity => entity.enabled)).toBe(true);
            })
        };
        const prepared12 = { instanceId: 12, body: {}, lattice: {}, metrics: { nodes: 3 } };
        const deps = {
            createPreparationTask: vi.fn(input => ({
                promise: Promise.resolve({ ...prepared12, instanceId: input.instance.id }),
                cancel: vi.fn()
            })),
            Simulator: vi.fn(),
            createSplatView: vi.fn(() => nextDynamics.shift()),
            destroySplatView: vi.fn(),
            attachGrabber: vi.fn(() => ({ detach: vi.fn() })),
            createGpuCandidate: vi.fn(async options => {
                const bundle = options.create();
                // Preserve references because createSplatView's queue is consumed.
                nextDynamics.push(...bundle.replacements.map(entry => entry.dynamic));
                const probe = options.validate(bundle);
                app.fire('update', 0);
                app.fire('frameend');
                await probe;
                return bundle;
            })
        };

        const candidate = await createSceneSimulationCandidate({
            app, scene, reference: {}, calibration: {}, container: {},
            participantIds: [7, 12], materials: { 7: material, 12: material },
            previousRuntime
        }, deps);

        expect(deps.createPreparationTask).toHaveBeenCalledOnce();
        expect(deps.createPreparationTask.mock.calls[0][0].instance.id).toBe(12);
        expect(previousSim.createAppendCandidate).toHaveBeenCalledWith([
            { ...prepared12, id: 12 }
        ]);
        expect(candidateSim.deformationOf.mock.calls.map(call => call[0])).toEqual([0, 1]);
        expect(oldDynamic7.enabled).toBe(true);
        expect(source12.enabled).toBe(true);
        expect(visible7.entity).toBe(oldDynamic7);

        const runtime = await candidate.publish({
            materials: {
                7: { ...material, density: 850 },
                12: { ...material, density: 950 }
            }
        });

        expect(previousSim.restoreAppendCandidate).toHaveBeenCalledWith(candidateSim);
        expect(candidateSim.syncCandidateMaterials).toHaveBeenCalledWith([
            { bodyId: 7, material: { ...material, density: 850 } },
            { bodyId: 12, material: { ...material, density: 950 } }
        ]);
        expect(previousRuntime.releaseForReplacement).toHaveBeenCalledOnce();
        expect(runtime.metrics).toEqual([
            { instanceId: 7, nodes: 2 },
            { instanceId: 12, nodes: 3 }
        ]);
        expect(visible7.entity.name).toBe('candidate-7');
        expect(visible12.entity.name).toBe('candidate-12');

        await runtime.returnToPreparation();
        expect(source7.enabled).toBe(true);
        expect(source12.enabled).toBe(true);
        expect(visible7.entity).toBe(source7);
        expect(visible12.entity).toBe(source12);
        expect(candidateSim.destroy).toHaveBeenCalledOnce();
    });

    it('restores the frozen dynamic view when append publication fails before commit', async () => {
        const app = emitter();
        const source7 = { enabled: false };
        const source12 = { enabled: true };
        const oldDynamic7 = { enabled: true };
        const visible7 = { id: 7, entity: oldDynamic7 };
        const visible12 = { id: 12, entity: source12 };
        const scene = {
            prepared: { groups: [
                { id: 7, name: 'A', cloud: simulationCloud() },
                { id: 12, name: 'B', cloud: simulationCloud() }
            ] },
            views: { groups: [visible7, visible12], root: { addChild: vi.fn() } }
        };
        const sim = {
            params: { paused: true },
            bodyIndexOf: id => id === 7 ? 0 : id === 12 ? 1 : -1,
            deformationOf: () => ({ shader: '', parameters: {} }),
            requestStep: vi.fn(), step: vi.fn(), syncCandidateMaterials: vi.fn(),
            resumeAfterAppend: vi.fn(), releaseGrab: vi.fn(), destroy: vi.fn(),
            stats: () => ({ simulatedTime: 1 })
        };
        const previousSim = {
            createAppendCandidate: () => sim,
            restoreAppendCandidate: vi.fn()
        };
        const previousRuntime = {
            simulator: previousSim,
            hasParticipant: id => id === 7,
            sourceEntityOf: id => id === 7 ? source7 : null,
            releaseForReplacement: vi.fn()
        };
        const dynamics = [
            { enabled: false, gsplat: { setParameter: vi.fn() } },
            { enabled: false, gsplat: { setParameter: vi.fn() } }
        ];
        const deps = {
            createPreparationTask: input => ({
                promise: Promise.resolve({ instanceId: input.instance.id, body: {}, lattice: {} }),
                cancel: vi.fn()
            }),
            createGpuCandidate: async options => options.create(),
            createSplatView: vi.fn(() => dynamics.shift()),
            destroySplatView: vi.fn(),
            attachGrabber: vi.fn(() => { throw new Error('grab binding failed'); })
        };
        const candidate = await createSceneSimulationCandidate({
            app, camera: {}, ownership: {}, scene, reference: {}, calibration: {}, container: {},
            participantIds: [7, 12], materials: { 7: material, 12: material }, previousRuntime
        }, deps);

        await expect(candidate.publish({ materials: { 7: material, 12: material } }))
            .rejects.toThrow('grab binding failed');

        expect(oldDynamic7.enabled).toBe(true);
        expect(source12.enabled).toBe(true);
        expect(visible7.entity).toBe(oldDynamic7);
        expect(visible12.entity).toBe(source12);
        expect(previousRuntime.releaseForReplacement).not.toHaveBeenCalled();
        expect(sim.destroy).toHaveBeenCalledOnce();
    });

    it('destroys a newly created dynamic view when the scene root rejects it', async () => {
        const app = emitter();
        const source = { enabled: true };
        const dynamic = { enabled: false };
        const sim = {
            params: { paused: false }, bodyIndexOf: () => 0,
            deformationOf: () => ({ shader: '', parameters: {} }), destroy: vi.fn()
        };
        const destroySplatView = vi.fn();
        const scene = {
            prepared: { groups: [{ id: 7, name: 'A', cloud: simulationCloud() }] },
            views: {
                groups: [{ id: 7, entity: source }],
                root: { addChild() { throw new Error('root rejected child'); } }
            }
        };
        await expect(createSceneSimulationCandidate({
            app, scene, reference: {}, calibration: {}, container: {},
            participantIds: [7], materials: { 7: material }
        }, {
            createPreparationTask: input => ({
                promise: Promise.resolve({ instanceId: input.instance.id, body: {}, lattice: {} }),
                cancel() {}
            }),
            createGpuCandidate: async options => options.create(),
            Simulator: class { constructor() { return sim; } },
            createSplatView: () => dynamic,
            destroySplatView
        })).rejects.toThrow('root rejected child');
        expect(destroySplatView).toHaveBeenCalledWith(dynamic);
        expect(sim.destroy).toHaveBeenCalledOnce();
    });
});

function simulationCloud() {
    return {
        count: 1,
        dimensionality: 2,
        positions: new Float32Array([0, 0, 0]),
        rotations: new Float32Array([0, 0, 0, 1]),
        scales: new Float32Array([0.1, 0.1, 0])
    };
}


describe('material edits while final GPU validation is pending', () => {
    it.each([900, -1])('uses the current density %s before publishing the first simulation', async density => {
        const f = fixture();
        const latest = { ...material };
        const uploadedDensities = [];
        f.simulator.syncCandidateMaterials.mockImplementation(updates => uploadedDensities.push(updates[0].material.density));
        let releaseValidation, reportWaiting;
        const validationGate = new Promise(resolve => { releaseValidation = resolve; });
        const waiting = new Promise(resolve => { reportWaiting = resolve; });
        const originalGpuCandidate = f.deps.createGpuCandidate;
        let validations = 0;
        f.deps.createGpuCandidate = vi.fn(async options => {
            const bundle = await originalGpuCandidate(options);
            if (++validations === 2) { reportWaiting(); await validationGate; }
            return bundle;
        });
        const session = new SimulationSession({
            preparation: { source: f.scene.prepared, transform: { scale: 1 }, calibration: {}, container: {} },
            participantIds: [7],
            readMaterials: () => {
                if (!(latest.density > 0)) throw new Error('latest density invalid');
                return { 7: latest };
            },
            createCandidate: options => createSceneSimulationCandidate({
                ...options, app: f.app, scene: f.scene, reference: {}
            }, f.deps)
        });
        const started = session.start();
        await waiting;
        latest.density = density;
        expect(session.getState().phase).toBe('preparing');
        expect(f.visible.entity).toBe(f.sourceEntity);
        releaseValidation();
        if (density > 0) {
            await started;
            expect(f.simulator.syncCandidateMaterials).toHaveBeenLastCalledWith([
                { bodyId: 7, material: { ...material, density } }
            ]);
            expect(uploadedDensities).toEqual([800, 900]);
            expect(session.getState().phase).toBe('running');
        } else {
            await expect(started).rejects.toThrow('latest density invalid');
            expect(session.getState().phase).toBe('preparation');
            expect(f.visible.entity).toBe(f.sourceEntity);
            expect(f.deps.destroySplatView).toHaveBeenCalledWith(f.dynamic);
        }
        await session.dispose();
    });
});
