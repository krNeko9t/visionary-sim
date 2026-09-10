import { createGroundGrid } from '../render/groundGrid.js';
import { createApp } from '../scene/app.js';
import { createStage } from '../scene/stage.js';
import { mountSceneImport } from '../ui/sceneImport.js';
import { createSceneImportTask, detectSceneImportCapabilities } from './import/workerClient.js';
import { createSceneDisplayCandidate } from './sceneDisplay.js';
import { SceneSession } from './sceneSession.js';
import { attachInstanceMaterials, createInstanceMaterials } from './instanceMaterials.js';
import { mountInstanceInspector } from '../ui/instanceInspector.js';
import { createInteractionOwnership } from '../ui/sceneSelection.js';
import { attachSceneNavigation } from '../ui/sceneNavigation.js';
import { applyInstanceColors } from '../render/instanceColors.js';
import { createSceneReference, resolveSceneTransform, compareSceneTransforms } from './sceneTransform.js';
import { createSceneContainer, editSceneContainer, followSceneCalibration, inspectSceneContainment } from '../render/sceneContainer.js';
import { createContainerEditor } from '../ui/containerEditor.js';
import { mountSceneCalibration } from '../ui/sceneCalibration.js';
import { mountSimulationControls } from '../ui/simulationControls.js';
import { SimulationSession } from './simulationSession.js';
import { createSceneSimulationCandidate } from './sceneSimulation.js';
import { createPreparationConfig } from './preparationConfig.js';
import { createSceneConfiguration, prepareSourceConfiguration } from './sceneConfiguration.js';
import { mountSceneConfiguration } from '../ui/sceneConfiguration.js';
import { createLocalSceneConfiguration } from './localSceneConfiguration.js';
import { mountLocalSceneConfiguration } from '../ui/localSceneConfiguration.js';

const INITIAL_BOUNDS = { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] };

const DEFAULT_DEPS = {
    createEngine: createApp,
    createGroundGrid,
    createImportTask: createSceneImportTask,
    createStage,
    createViews: createSceneDisplayCandidate,
    detectCapabilities: detectSceneImportCapabilities,
    mountImport: mountSceneImport,
    mountInspector: mountInstanceInspector,
    attachNavigation: attachSceneNavigation,
    applyColors: applyInstanceColors,
    mountCalibration: mountSceneCalibration,
    mountSimulationControls,
    createSimulationCandidate: createSceneSimulationCandidate,
    mountConfiguration: mountSceneConfiguration,
    mountLocalConfiguration: mountLocalSceneConfiguration,
    SimulationSession
};

/** The formal local-file scene workbench application session. */
export class SceneApplication {
    constructor({ canvas, host = document.body, browser = window, deps = {} }) {
        this.canvas = canvas;
        this.host = host;
        this.browser = browser;
        this.deps = { ...DEFAULT_DEPS, ...deps };
        this.phase = 'idle';
        this.engine = null;
        this.session = null;
        this.panel = null;
        this.grid = null;
        this.listeners = new Set();
        this.startPromise = null;
        this.cleanupPromise = null;
        this.destroyPromise = null;
        this.generation = 0;
        this.unsubscribeSession = null;
        this.onPageHide = () => this.destroy();
        this.camera = null;
        this.pointerOwnership = createInteractionOwnership();
        this.selectionOwner = null;
        this.inspection = null;
        this.inspector = null;
        this.navigation = null;
        this.interactionError = null;
        this.preparation = null;
        this.preparationScene = null;
        this.preparationPhase = 'prepare';
        this.calibrationPanel = null;
        this.simulation = null;
        this.unsubscribeSimulation = null;
        this.simulationPanel = null;
        this.configuration = null;
        this.configurationPanel = null;
        this.localConfiguration = null;
        this.localConfigurationPanel = null;
        this.unsubscribeConfiguration = null;
        this.unsubscribeLocalConfiguration = null;
    }

    start() {
        if (this.phase === 'running') return Promise.resolve(this);
        if (this.phase === 'starting') return this.startPromise;
        if (this.phase === 'destroyed') return Promise.reject(new Error('cannot restart a destroyed application'));
        this.cleanupPromise = null;
        const generation = ++this.generation;
        this.phase = 'starting';
        this.notify();
        this.startPromise = this.assemble(generation).then(() => {
            this.assertCurrent(generation);
            this.phase = 'running';
            this.notify();
            return this;
        }).catch(async error => {
            try { await this.cleanup(); } finally {
                if (this.phase !== 'destroyed') this.phase = 'failed';
                this.startPromise = null;
                this.notify();
            }
            throw error;
        });
        return this.startPromise;
    }

    async assemble(generation) {
        const engine = await this.deps.createEngine(this.canvas);
        try { this.assertCurrent(generation); } catch (error) {
            await engine.destroy();
            throw error;
        }
        this.engine = engine;
        const { camera, controls } = this.deps.createStage(this.engine, INITIAL_BOUNDS);
        this.camera = camera;
        if (controls) controls.enabled = false;
        this.grid = this.deps.createGroundGrid(this.engine, camera);
        const capabilities = this.deps.detectCapabilities({ graphicsDevice: this.engine.graphicsDevice, environment: this.browser });
        this.session = new SceneSession({
            prepareTask: (files, progress) => this.deps.createImportTask(files, progress),
            createViews: (prepared, options) => this.deps.createViews(this.engine, prepared, options),
            prepareScene: scene => this.deps.applyColors(scene.views.groups, { colorMode: 'source', selectedId: null })
        });
        this.panel = this.deps.mountImport({ host: this.host, session: this.session, capabilities });
        this.inspection = attachInstanceMaterials(this.session);
        this.unsubscribeSession = this.inspection.subscribe(state => {
            this.synchronizePreparation(state.scene);
            if (state.inspection) this.deps.applyColors(state.scene.views.groups, state.inspection);
            this.applyRuntimeMaterials(state.inspection);
            this.notify();
        });
        this.inspector = this.deps.mountInspector({ root: this.host, materials: {
            subscribe: listener => this.inspection.subscribe(listener),
            selectInstance: id => this.selectInstance(id),
            setColorMode: mode => this.setColorMode(mode),
            setMaterialOverride: (id, patch) => this.setMaterialOverride(id, patch),
            clearMaterialOverride: (id, fields) => this.clearMaterialOverride(id, fields)
        } });
        // Move the known import panel into the left scroll column, leaving the
        // canvas and the right inspector clear in the selected A layout.
        this.inspector.element.querySelector?.('.instance-import-slot')?.append(this.panel.element);
        this.navigation = this.deps.attachNavigation({
            app: this.engine, camera, canvas: this.canvas, ownership: this.pointerOwnership,
            getScene: () => this.session?.getState().scene,
            select: id => this.selectInstance(id),
            onError: message => { this.interactionError = message; this.notify(); }
        });
        this.selectionOwner = this.navigation.selection;
        this.calibrationPanel = this.deps.mountCalibration({
            application: this, app: this.engine, camera, canvas: this.canvas,
            host: this.inspector.element.querySelector?.('.instance-left') ?? this.host
        });
        if (this.inspector.element.querySelector) {
            this.simulationPanel = this.deps.mountSimulationControls({
                host: this.inspector.element.querySelector('.instance-simulation-slot') ?? this.host,
                application: this
            });
        }
        this.configuration = createSceneConfiguration({
            readConfiguration: () => this.readPreparationConfiguration(),
            prepareImport: (files, options) => this.prepareConfigurationImport(files, options)
        });
        this.localConfiguration = createLocalSceneConfiguration(this.configuration, { storage: this.deps.localStorage });
        this.unsubscribeConfiguration = this.configuration.subscribe(() => this.notify());
        this.unsubscribeLocalConfiguration = this.localConfiguration.subscribe(() => this.notify());
        if (this.inspector.element.querySelector) {
            this.configurationPanel = this.deps.mountConfiguration({
                host: this.inspector.element.querySelector('.instance-left') ?? this.host,
                controller: this.configuration
            });
            this.localConfigurationPanel = this.deps.mountLocalConfiguration(
                this.configurationPanel.storageHost, this.localConfiguration);
        }
        this.browser.addEventListener('pagehide', this.onPageHide);
        this.engine.start();
    }

    state() {
        return {
            phase: this.phase,
            scene: this.session?.getState().scene ?? null,
            import: this.session?.getState().import ?? null,
            inspection: this.inspection?.getState().inspection ?? null,
            interactionError: this.interactionError,
            preparation: this.preparation,
            preparationPhase: this.preparationPhase,
            configuration: this.configuration?.getState() ?? null,
            localConfiguration: this.localConfiguration?.getState() ?? null,
            preparationEditable: !!this.preparation?.transform && this.preparationPhase === 'prepare' && this.session?.getState().import.status !== 'running',
            simulation: this.simulation ? {
                ...this.simulation.getState(),
                metrics: this.simulation.runtime?.metrics ?? null,
                timing: this.simulation.runtime?.getTiming?.() ?? null
            } : null
        };
    }

    subscribe(listener) {
        this.listeners.add(listener);
        try { listener(this.state()); } catch (error) { this.listeners.delete(listener); throw error; }
        return () => this.listeners.delete(listener);
    }

    notify() {
        const state = this.state();
        for (const listener of this.listeners) {
            try {
                listener(state);
            } catch (error) {
                console.error('[scene-application] subscriber failed', error);
            }
        }
    }

    importScene(files) {
        if (this.phase !== 'running') return Promise.reject(new Error('application is not running'));
        return this.session.importScene(files);
    }

    cancelImport() {
        this.configuration?.cancel();
        return this.session?.cancelImport() ?? false;
    }

    setGrabbing(enabled) {
        return this.simulation?.setGrabbing(enabled) ?? Promise.reject(new Error('模拟不可用'));
    }

    readPreparationConfiguration() {
        const state = this.state();
        if (!state.scene || !state.preparation?.transform) throw new Error('请先导入有效场景再导出准备配置');
        return createPreparationConfig({
            sources: state.scene.prepared.sources,
            ...this.getSourceConfiguration(),
            materialOverrides: Object.fromEntries(state.inspection.instances
                .filter(instance => Object.keys(instance.overrides).length)
                .map(instance => [instance.id, instance.overrides])),
            participantIds: state.simulation?.participantIds ?? [],
            instanceIds: state.scene.prepared.instances.map(instance => instance.id)
        });
    }

    async prepareConfigurationImport(files, { signal } = {}) {
        if (this.phase !== 'running') throw new Error('application is not running');
        const transaction = await this.session.prepareImport(files, { signal, deferValidation: true });
        const scene = transaction.scene;
        let committed = false;
        return {
            sources: scene.prepared.sources,
            instanceIds: scene.prepared.instances.map(instance => instance.id),
            prepareConfiguration: config => transaction.validate(() => {
                const preparation = prepareSourceConfiguration(scene, config);
                if (!gpuLinearTransformIsUsable(preparation.transform.matrix)) throw new Error('配置的 GPU 线性变换已退化');
                const root = scene.views.root;
                root.setLocalPosition(...preparation.transform.translation);
                root.setLocalRotation(...preparation.transform.rotation);
                root.setLocalScale(preparation.transform.scale, preparation.transform.scale, preparation.transform.scale);
                scene.configuration = config;
                scene.stagedPreparation = preparation;
                scene.stagedMaterials = createInstanceMaterials([
                    ...(scene.prepared.untrackedCount > 0 ? [{ id: 0, name: '未追踪内容', count: scene.prepared.untrackedCount }] : []),
                    ...scene.prepared.instances
                ], { overrides: config?.materialOverrides ?? {} });
                this.deps.applyColors(scene.views.groups, scene.stagedMaterials.getState());
                scene.stagedSimulation = this.createSimulationSession(scene, preparation, config?.participantIds ?? []);
            }),
            commit: () => {
                if (signal?.aborted) throw new Error('配置关联已取消');
                transaction.commit();
                committed = true;
            },
            dispose: async () => {
                if (committed) return;
                try {
                    scene.stagedMaterials?.dispose();
                    await scene.stagedSimulation?.dispose();
                }
                finally { await transaction.dispose(); }
            }
        };
    }

    selectInstance(id) {
        this.selectionOwner?.invalidate();
        this.inspection.selectInstance(id);
    }

    setColorMode(mode) { this.inspection.setColorMode(mode); }
    setMaterialOverride(id, patch) { this.inspection.setMaterialOverride(id, patch); }
    clearMaterialOverride(id, fields) { this.inspection.clearMaterialOverride(id, fields); }

    addSelectedToSimulation() {
        const selected = this.state().inspection?.selected;
        if (!selected) return Promise.reject(new Error('请先选择实例'));
        if (!selected.eligible) return Promise.reject(new Error(`实例 ${selected.id} 的物性无效`));
        return this.simulation.addParticipant(selected.id);
    }

    cancelSimulationPreparation() { return this.simulation?.cancelPreparation() ?? false; }
    startSimulation() { return this.simulation?.start() ?? Promise.reject(new Error('模拟不可用')); }
    pauseSimulation() { return this.simulation?.pause() ?? Promise.reject(new Error('模拟不可用')); }
    resumeSimulation() { return this.simulation?.resume() ?? Promise.reject(new Error('模拟不可用')); }
    returnToPreparation() { return this.simulation?.returnPreparation() ?? Promise.resolve(); }

    synchronizePreparation(scene) {
        if (scene === this.preparationScene) return;
        this.preparationScene = scene;
        this.preparationPhase = 'prepare';
        this.selectionOwner?.invalidate();
        this.releaseSimulationSession();
        if (!scene) { this.preparation = null; return; }
        if (scene.stagedPreparation) {
            this.preparation = scene.stagedPreparation;
            this.installSimulationSession(scene, scene.stagedSimulation);
            return;
        }
        try {
            const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
            let count = 0;
            for (const { cloud } of scene.prepared.groups) {
                for (let i = 0; i < cloud.positions.length; i++) {
                    const value = cloud.positions[i];
                    if (!Number.isFinite(value)) throw new Error('场景中心包含非有限值，无法模拟');
                    min[i % 3] = Math.min(min[i % 3], value);
                    max[i % 3] = Math.max(max[i % 3], value);
                }
                count += cloud.count;
            }
            if (!count) throw new Error('空场景无法模拟');
            const reference = createSceneReference([...min, ...max]);
            reference.count = count;
            for (const value of Object.values(reference)) if (Array.isArray(value)) Object.freeze(value);
            Object.freeze(reference);
            const transform = resolveSceneTransform(reference);
            const container = createSceneContainer(reference, transform);
            this.publishPreparation(transform, container, 0);
            this.installSimulationSession(scene);
        } catch (error) {
            this.preparation = { error: error.message, transform: null, container: null };
        }
    }

    assertPreparationEditable() {
        if (!this.state().preparationEditable) throw new Error('请先返回准备阶段并完成导入，再编辑校正或容器');
    }

    setCalibration(patch) {
        this.assertPreparationEditable();
        const old = this.preparation;
        const transform = resolveSceneTransform(old.reference, { ...old.calibration, ...patch });
        const changes = compareSceneTransforms(old.transform, transform);
        this.publishPreparation(transform, followSceneCalibration(old.container, transform),
            old.lengthRevision + Number(changes.lengthDerivedInvalid));
        this.notify();
    }

    editContainer(patch) {
        this.assertPreparationEditable();
        const old = this.preparation;
        const editor = createContainerEditor(old.container.world);
        const pose = editor.updateFromNumbers(patch);
        this.publishPreparation(old.transform, editSceneContainer(old.container, old.transform, pose), old.lengthRevision);
        this.notify();
    }

    // 05/07 call this from their observable simulation phase transitions.
    setPreparationPhase(phase) {
        if (!['prepare', 'preparing', 'running', 'paused', 'returning'].includes(phase)) throw new Error('unknown preparation phase');
        this.preparationPhase = phase;
        this.selectionOwner?.invalidate();
        this.notify();
    }

    getSourceConfiguration() {
        if (!this.preparation?.transform) throw new Error('场景校正不可用');
        return structuredClone({ calibration: this.preparation.calibration, container: this.preparation.container.world });
    }

    restoreSourceConfiguration({ calibration, container }) {
        this.assertPreparationEditable();
        const old = this.preparation;
        const transform = resolveSceneTransform(old.reference, calibration);
        const restored = editSceneContainer(old.container, transform, container);
        this.publishPreparation(transform, restored, old.lengthRevision + Number(old.transform.scale !== transform.scale));
        this.notify();
    }

    publishPreparation(transform, container, lengthRevision) {
        const gpuValues = [...transform.matrix, ...transform.worldBounds.min, ...transform.worldBounds.max,
            ...container.world.position, ...container.world.dimensions];
        if (gpuValues.some(value => !Number.isFinite(Math.fround(value)))) {
            throw new Error('校正或容器超出 GPU 有限坐标范围');
        }
        if (!(Math.fround(transform.scale) > 0) ||
            container.world.dimensions.some(value => !(Math.fround(value) > 0)) ||
            !gpuLinearTransformIsUsable(transform.matrix)) {
            throw new Error('校正或容器在 GPU Float32 精度下会退化为零尺寸');
        }
        let outsideCount = 0, totalCount = 0;
        for (const { cloud } of this.preparationScene.prepared.groups) {
            const result = inspectSceneContainment(container.relative, cloud.positions);
            outsideCount += result.outsideCount; totalCount += result.totalCount;
        }
        const root = this.preparationScene.views.root;
        root.setLocalPosition(...transform.translation);
        root.setLocalRotation(...transform.rotation);
        root.setLocalScale(transform.scale, transform.scale, transform.scale);
        this.preparation = Object.freeze({ reference: transform.reference, calibration: transform.config,
            transform, container, lengthRevision, error: null,
            containment: { outsideCount, totalCount, warning: outsideCount ? `${outsideCount} / ${totalCount} 个场景中心在容器外；源场景未移动` : null } });
        this.simulation?.updatePreparation({
            transform,
            calibration: transform.config,
            container: container.world
        });
        this.selectionOwner?.invalidate();
    }

    createSimulationSession(scene, preparation = this.preparation, participantIds = []) {
        return new this.deps.SimulationSession({
            participantIds,
            preparation: {
                source: scene.prepared,
                transform: preparation.transform,
                calibration: preparation.calibration,
                container: preparation.container.world
            },
            readMaterials: ids => this.readSimulationMaterials(ids),
            createCandidate: options => this.deps.createSimulationCandidate({
                ...options,
                app: this.engine,
                camera: this.camera,
                canvas: this.canvas,
                ownership: this.pointerOwnership,
                onError: error => {
                    this.interactionError = error instanceof Error ? error.message : String(error);
                    this.notify();
                },
                scene,
                reference: preparation.reference
            })
        });
    }

    installSimulationSession(scene, simulation = this.createSimulationSession(scene)) {
        this.simulation = simulation;
        this.unsubscribeSimulation = this.simulation.subscribe(state => {
            this.setPreparationPhase(state.phase === 'preparation' ? 'prepare' : state.phase);
        });
    }

    readSimulationMaterials(ids) {
        const entries = new Map((this.inspection?.getState().inspection?.instances ?? [])
            .map(instance => [instance.id, instance]));
        return Object.fromEntries(ids.map(id => {
            const instance = entries.get(id);
            if (!instance?.eligible) throw new Error(`实例 ${id} 的最新物性无效`);
            return [id, { ...instance.effectiveMaterial }];
        }));
    }

    applyRuntimeMaterials(inspection) {
        const simulation = this.simulation;
        if (!simulation || !inspection) return;
        for (const instance of inspection.instances) {
            if (!instance.eligible || !simulation.getState().participantIds.includes(instance.id)) continue;
            simulation.synchronizeMaterial(instance.id).catch(error =>
                console.error('[scene-simulation] failed to synchronize material', error));
        }
    }

    releaseSimulationSession() {
        this.unsubscribeSimulation?.();
        this.unsubscribeSimulation = null;
        const simulation = this.simulation;
        this.simulation = null;
        if (!simulation) return null;
        try {
            const active = simulation.active?.promise ?? null;
            const released = simulation.dispose?.() ?? simulation.returnPreparation?.();
            return Promise.allSettled([active, released].filter(Boolean)).then(results => {
                for (const result of results) {
                    if (result.status === 'rejected') {
                        console.error('[scene-simulation] failed to release session', result.reason);
                    }
                }
            });
        } catch (error) {
            console.error('[scene-simulation] failed to release session', error);
            return Promise.resolve();
        }
    }

    destroy() {
        if (this.destroyPromise) return this.destroyPromise;
        ++this.generation;
        const starting = this.phase === 'starting' ? this.startPromise : null;
        this.phase = 'destroyed';
        let resolve, reject;
        this.destroyPromise = new Promise((done, fail) => { resolve = done; reject = fail; });
        try {
            const cleanup = this.cleanup();
            Promise.all([cleanup, starting?.catch(() => {})]).then(resolve, reject);
        } catch (error) { reject(error); }
        this.notify();
        this.listeners.clear();
        return this.destroyPromise;
    }

    cleanup() {
        if (this.cleanupPromise) return this.cleanupPromise;
        this.browser.removeEventListener('pagehide', this.onPageHide);
        this.unsubscribeConfiguration?.();
        this.unsubscribeLocalConfiguration?.();
        this.unsubscribeConfiguration = this.unsubscribeLocalConfiguration = null;
        this.localConfigurationPanel?.dispose();
        this.configurationPanel?.dispose();
        this.localConfiguration?.dispose();
        this.configuration?.dispose();
        this.configurationPanel = this.localConfigurationPanel = null;
        this.configuration = this.localConfiguration = null;
        this.unsubscribeSession?.();
        this.unsubscribeSession = null;
        this.calibrationPanel?.dispose();
        this.calibrationPanel = null;
        this.simulationPanel?.dispose();
        this.simulationPanel = null;
        const simulationRelease = this.releaseSimulationSession();
        this.navigation?.dispose();
        this.navigation = null;
        this.selectionOwner = null;
        this.pointerOwnership.clear();
        this.inspector?.dispose();
        this.inspector = null;
        this.inspection?.dispose();
        this.inspection = null;
        this.panel?.dispose();
        this.panel = null;
        const sceneRelease = this.session?.dispose();
        this.session = null;
        this.grid?.dispose();
        this.grid = null;
        const engine = this.engine;
        this.engine = null;
        this.camera = null;
        if (simulationRelease || sceneRelease) {
            this.cleanupPromise = Promise.allSettled([simulationRelease, sceneRelease]).then(() => engine?.destroy());
        } else {
            // Keep the no-pending-work path synchronous while exposing a stable
            // public promise for real asynchronous resource owners.
            this.cleanupPromise = Promise.resolve(engine?.destroy());
        }
        return this.cleanupPromise;
    }

    assertCurrent(generation) {
        if (generation !== this.generation || this.phase === 'destroyed') {
            throw new Error('application session ended during startup');
        }
    }
}

function gpuLinearTransformIsUsable(matrix) {
    const columns = [0, 1, 2].map(column => [
        matrix[column * 4], matrix[column * 4 + 1], matrix[column * 4 + 2]
    ]);
    const lengths = columns.map(column => Math.hypot(...column));
    if (lengths.some(length => !(length > 0) || !(Math.fround(length) > 0))) return false;
    for (let left = 0; left < 3; left++) {
        for (let right = left + 1; right < 3; right++) {
            const dot = columns[left].reduce((sum, value, axis) =>
                sum + value * columns[right][axis], 0);
            if (Math.abs(dot) > lengths[left] * lengths[right] * 1e-6) return false;
        }
    }
    return true;
}
