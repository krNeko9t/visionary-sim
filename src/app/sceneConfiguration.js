import { validatePreparationConfig, parsePreparationConfig, matchPreparationFingerprints } from './preparationConfig.js';
import { createSceneReference, resolveSceneTransform } from './sceneTransform.js';
import { createSceneContainer, editSceneContainer, inspectSceneContainment } from '../render/sceneContainer.js';

/** Validate all source-dependent edits before the scene can become visible. */
export function prepareSourceConfiguration(scene, configuration = null) {
    const prepared = scene.prepared;
    const config = configuration && validatePreparationConfig(configuration, {
        instanceIds: prepared.instances.map(instance => instance.id)
    });
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    let count = 0;
    for (const { cloud } of prepared.groups) {
        if (!cloud.positions.length || cloud.positions.length !== cloud.count * 3) throw new Error('场景中心数组不完整');
        for (let at = 0; at < cloud.positions.length; at++) {
            const value = cloud.positions[at];
            if (!Number.isFinite(value)) throw new Error('场景中心包含非有限值');
            min[at % 3] = Math.min(min[at % 3], value);
            max[at % 3] = Math.max(max[at % 3], value);
        }
        count += cloud.count;
    }
    if (!count) throw new Error('空场景无法恢复配置');
    const reference = createSceneReference([...min, ...max]);
    reference.count = count;
    for (const value of Object.values(reference)) if (Array.isArray(value)) Object.freeze(value);
    Object.freeze(reference);
    const transform = resolveSceneTransform(reference, config?.calibration);
    const initial = createSceneContainer(reference, transform);
    const resolvedContainer = config ? editSceneContainer(initial, transform, config.container) : initial;
    // Keep the authored world pose exactly: re-export must not repeatedly add
    // the round-off of world -> relative -> world conversions.
    const container = config ? Object.freeze({ relative: resolvedContainer.relative, world: config.container }) : initial;
    const gpuValues = [...transform.matrix, ...transform.worldBounds.min, ...transform.worldBounds.max,
        ...container.world.position, ...container.world.dimensions];
    if (gpuValues.some(value => !Number.isFinite(Math.fround(value)))) throw new Error('校正或容器超出 GPU 有限坐标范围');
    if (!(Math.fround(transform.scale) > 0) || container.world.dimensions.some(value => !(Math.fround(value) > 0))) {
        throw new Error('校正或容器在 GPU Float32 精度下会退化为零尺寸');
    }
    let outsideCount = 0, totalCount = 0;
    for (const { cloud } of prepared.groups) {
        const result = inspectSceneContainment(container.relative, cloud.positions);
        outsideCount += result.outsideCount; totalCount += result.totalCount;
    }
    return Object.freeze({ reference, calibration: transform.config, transform, container,
        lengthRevision: 0, error: null, containment: {
            outsideCount, totalCount,
            warning: outsideCount ? `${outsideCount} / ${totalCount} 个场景中心在容器外；源场景未移动` : null
        } });
}

/**
 * Portable configuration workflow. Import candidates own all unpublished source,
 * view and preparation resources. prepareImport reads/hashes sources once and
 * returns { sources, instanceIds, prepareConfiguration, commit, dispose }.
 * prepareConfiguration validates derived geometry, stages authored edits and
 * awaits the final display's GPU validation;
 * commit synchronously publishes the complete candidate in preparation phase.
 * Neither operation starts simulation. Container poses use world coordinates,
 * matching SceneApplication.getSourceConfiguration/restoreSourceConfiguration.
 */
export function createSceneConfiguration({ readConfiguration, prepareImport }) {
    let state = Object.freeze({ status: 'idle', pending: null, error: null, message: '可导出准备配置，或导入配置并重新选择源文件。' });
    let active = null;
    let disposed = false;
    const listeners = new Set();
    function publish(patch) {
        state = Object.freeze({ ...state, ...patch });
        for (const listener of listeners) {
            try { listener(state); } catch (error) { console.error('[scene-configuration] subscriber failed', error); }
        }
    }
    function requireActive() {
        if (disposed) throw new Error('configuration controller has been disposed');
    }
    function cancel() {
        if (!active) return;
        active.abort();
        active = null;
        publish({ status: state.pending ? 'awaiting-sources' : 'idle', message: '已取消；当前场景和配置保留。' });
    }
    function importConfiguration(value) {
        requireActive();
        try {
            const config = typeof value === 'string' ? parsePreparationConfig(value) : validatePreparationConfig(value);
            cancel();
            publish({ status: 'awaiting-sources', pending: config, error: null,
                message: '配置已校验，请重新选择三个源文件；尚未恢复场景。' });
            return config;
        } catch (error) {
            publish({ error: error.message, message: `配置未导入：${error.message}` });
            throw error;
        }
    }
    function exportConfiguration() {
        requireActive();
        // Validate the actual artifact, never filter unknown runtime fields.
        return validatePreparationConfig(readConfiguration());
    }
    return Object.freeze({
        getState: () => state,
        subscribe(listener) {
            requireActive();
            listeners.add(listener);
            try { listener(state); } catch (error) { listeners.delete(listener); throw error; }
            return () => listeners.delete(listener);
        },
        exportConfiguration,
        exportJSON() {
            return JSON.stringify(exportConfiguration(), null, 2);
        },
        importConfiguration,
        async associateSources(files) {
            requireActive();
            cancel();
            const controller = new AbortController();
            active = controller;
            const pending = state.pending;
            let candidate;
            let committed = false;
            const assertCurrent = () => {
                if (disposed || controller.signal.aborted || active !== controller) {
                    throw new DOMException('配置关联已取消', 'AbortError');
                }
            };
            publish({ status: 'reading-sources', error: null, message: '读取并校验源文件，当前场景保持可用。' });
            try {
                candidate = await prepareImport(files, { signal: controller.signal });
                assertCurrent();
                const match = pending ? matchPreparationFingerprints(pending, candidate.sources,
                    { instanceIds: candidate.instanceIds }) : null;
                const mismatch = match?.mismatchedSlots ?? [];
                const restored = pending && mismatch.length === 0
                    ? validatePreparationConfig(pending, { instanceIds: candidate.instanceIds }) : null;
                if (restored && candidate.instanceIds === undefined) throw new Error('源实例目录尚未验证');
                await candidate.prepareConfiguration(restored);
                assertCurrent();
                candidate.commit();
                committed = true;
                active = null;
                publish({ status: restored ? 'restored' : 'new-scene', pending: null, error: null,
                    message: restored ? '配置与名单已恢复到准备阶段；点击开始后才生成模拟资源。'
                        : pending ? `内容不同（${mismatch.join('、')}），已作为新场景导入，未套用旧配置。` : '新场景已导入准备阶段。' });
                return { restored: !!restored, mismatchedSlots: mismatch };
            } catch (error) {
                if (active === controller) {
                    active = null;
                    publish({ status: pending ? 'awaiting-sources' : 'failed', error: error.message,
                        message: `未替换当前场景：${error.message}` });
                }
                throw error;
            } finally {
                if (candidate && !committed) {
                    try { await candidate.dispose(); } catch (error) { console.error('[scene-configuration] candidate cleanup failed', error); }
                }
            }
        },
        cancel,
        dispose() {
            if (disposed) return;
            cancel();
            disposed = true;
            listeners.clear();
        }
    });
}
