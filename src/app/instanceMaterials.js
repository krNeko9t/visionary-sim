import { POISSON_RANGE } from '../body/material.js';

/** The three upstream quantities that decide whether an instance may be prepared. */
export const INSTANCE_MATERIAL_FIELDS = Object.freeze([
    Object.freeze({
        key: 'density',
        sourceKey: 'rho_si',
        label: '密度',
        unit: 'kg/m³'
    }),
    Object.freeze({
        key: 'youngsModulus',
        sourceKey: 'E_si',
        label: '杨氏模量',
        unit: 'Pa'
    }),
    Object.freeze({
        key: 'poissonRatio',
        sourceKey: 'nu_si',
        label: '泊松比',
        unit: '无量纲'
    })
]);

const FIELD_BY_NAME = new Map(INSTANCE_MATERIAL_FIELDS.flatMap(field => [
    [field.key, field],
    [field.sourceKey, field]
]));

const ASSESSMENT_KEYS = [
    'trust', 'uncertainty', 'uncertainties', 'confidence', 'confidence_score',
    'mu_z', 'var', 'mu_spread', 'mu_mean_per_gaussian_z',
    'source', 'method', 'notes'
];

/**
 * Owns stable instance selection and authored material overrides.
 *
 * This state deliberately has no simulation or rendering dependency. Import may
 * install incomplete records, and editing them never allocates a simulation
 * resource. A later application operation decides when an eligible snapshot is
 * applied to a body.
 *
 * @param {object[]} catalog - Prepared source instance catalog in original IDs.
 * @param {object} [options]
 * @param {number|null} [options.selectedId]
 * @param {Record<string, object>|Map<number, object>} [options.overrides]
 * @returns {object} Observable material and selection operations.
 */
export function createInstanceMaterials(catalog, { selectedId = null, overrides = {} } = {}) {
    if (!Array.isArray(catalog)) throw new TypeError('instance catalog must be an array');

    const untrackedSource = catalog.find(entry => entry.id === 0) ?? null;
    const entries = catalog.filter(entry => entry.id !== 0).map(normalizeEntry);
    const byId = new Map();
    for (const entry of entries) {
        if (byId.has(entry.id)) throw new Error(`duplicate instance ID ${entry.id}`);
        byId.set(entry.id, entry);
    }

    const overrideById = new Map();
    const initialOverrides = overrides instanceof Map ? overrides : new Map(Object.entries(overrides));
    for (const [rawId, patch] of initialOverrides) {
        const id = Number(rawId);
        requireKnownId(byId, id);
        overrideById.set(id, normalizePatch(patch));
    }

    if (selectedId !== null) requireKnownId(byId, selectedId);
    let selection = selectedId;
    let colorMode = 'source';
    let disposed = false;
    const listeners = new Set();

    const state = () => {
        const instances = entries.map(entry => materialState(entry, overrideById.get(entry.id) ?? {}));
        return Object.freeze({
            selectedId: selection,
            selected: instances.find(instance => instance.id === selection) ?? null,
            colorMode,
            materialFields: INSTANCE_MATERIAL_FIELDS,
            untracked: untrackedSource ? Object.freeze({
                id: 0,
                name: String(untrackedSource.name ?? '未追踪内容'),
                count: finiteCount(untrackedSource.count)
            }) : null,
            instances: Object.freeze(instances)
        });
    };

    const notify = () => {
        const snapshot = state();
        for (const listener of listeners) listener(snapshot);
    };

    return Object.freeze({
        getState() {
            requireActive(disposed);
            return state();
        },

        subscribe(listener) {
            requireActive(disposed);
            if (typeof listener !== 'function') throw new TypeError('listener must be a function');
            listeners.add(listener);
            listener(state());
            return () => listeners.delete(listener);
        },

        selectInstance(id) {
            requireActive(disposed);
            if (id !== null) requireKnownId(byId, id);
            selection = id;
            notify();
        },

        setColorMode(mode) {
            requireActive(disposed);
            if (mode !== 'source' && mode !== 'instances') {
                throw new Error(`unknown instance color mode "${mode}"`);
            }
            colorMode = mode;
            notify();
        },

        setMaterialOverride(id, patch) {
            requireActive(disposed);
            requireKnownId(byId, id);
            const current = overrideById.get(id) ?? {};
            overrideById.set(id, { ...current, ...normalizePatch(patch) });
            notify();
        },

        clearMaterialOverride(id, fields = null) {
            requireActive(disposed);
            requireKnownId(byId, id);
            if (fields === null) {
                overrideById.delete(id);
            } else {
                const next = { ...(overrideById.get(id) ?? {}) };
                for (const name of fields) {
                    const field = FIELD_BY_NAME.get(name);
                    if (!field) throw new Error(`unknown material field "${name}"`);
                    delete next[field.key];
                }
                if (Object.keys(next).length) overrideById.set(id, next);
                else overrideById.delete(id);
            }
            notify();
        },

        dispose() {
            if (disposed) return;
            disposed = true;
            listeners.clear();
        }
    });
}

/**
 * Adds inspection state and operations beside a SceneSession without changing
 * the import/session implementation. Failed imports retain the same inspection
 * object because SceneSession retains the same published scene.
 *
 * @param {{getState: Function, subscribe: Function}} sceneSession
 */
export function attachInstanceMaterials(sceneSession) {
    let sourceScene = null;
    let materials = null;
    let sceneState = sceneSession.getState();
    let disposed = false;
    const listeners = new Set();

    const install = next => {
        sceneState = next;
        if (next.scene === sourceScene) return;
        sourceScene = next.scene;
        materials?.dispose();
        const prepared = next.scene?.prepared;
        materials = next.scene?.stagedMaterials ?? (prepared ? createInstanceMaterials([
            ...(prepared.untrackedCount > 0 ? [{ id: 0, name: '未追踪内容', count: prepared.untrackedCount }] : []),
            ...(prepared.instances ?? [])
        ], { overrides: next.scene.configuration?.materialOverrides ?? {} }) : null);
        materials?.subscribe(() => emit());
    };

    const state = () => Object.freeze({
        ...sceneState,
        inspection: materials?.getState() ?? null
    });
    const emit = () => {
        if (disposed) return;
        const snapshot = state();
        for (const listener of listeners) listener(snapshot);
    };
    install(sceneState);
    const unsubscribeScene = sceneSession.subscribe(next => {
        const changed = next.scene !== sourceScene;
        install(next);
        if (!changed || !next.scene) emit();
    });
    const run = operation => {
        if (disposed) throw new Error('instance inspection has been disposed');
        if (!materials) throw new Error('no scene is available for instance inspection');
        return operation(materials);
    };

    return Object.freeze({
        getState() {
            if (disposed) throw new Error('instance inspection has been disposed');
            return state();
        },
        subscribe(listener) {
            if (disposed) throw new Error('instance inspection has been disposed');
            listeners.add(listener);
            listener(state());
            return () => listeners.delete(listener);
        },
        selectInstance: id => run(current => current.selectInstance(id)),
        setColorMode: mode => run(current => current.setColorMode(mode)),
        setMaterialOverride: (id, patch) => run(current => current.setMaterialOverride(id, patch)),
        clearMaterialOverride: (id, fields) => run(current => current.clearMaterialOverride(id, fields)),
        dispose() {
            if (disposed) return;
            disposed = true;
            unsubscribeScene();
            materials?.dispose();
            materials = null;
            listeners.clear();
        }
    });
}

function normalizeEntry(entry) {
    if (!Number.isInteger(entry?.id) || entry.id <= 0) {
        throw new Error(`editable instance ID must be a positive integer; received ${entry?.id}`);
    }
    const source = sourceRecord(entry);
    return Object.freeze({
        id: entry.id,
        name: String(entry.name ?? `实例 ${entry.id}`),
        count: finiteCount(entry.count ?? entry.n_gau),
        sourceMaterial: Object.freeze(readMaterial(source)),
        upstreamAssessment: Object.freeze(readAssessment(source, entry))
    });
}

function sourceRecord(entry) {
    if (entry.sourceMaterial !== undefined) return entry.sourceMaterial ?? {};
    if (entry.material && has(entry.material, 'source')) return entry.material.source ?? {};
    return entry.material ?? entry.physics ?? entry;
}

function readMaterial(source) {
    const material = {};
    for (const field of INSTANCE_MATERIAL_FIELDS) {
        if (has(source, field.key)) material[field.key] = source[field.key];
        else if (has(source, field.sourceKey)) material[field.key] = source[field.sourceKey];
    }
    return material;
}

function readAssessment(source, entry) {
    const assessment = {};
    const explicit = entry.upstreamAssessment ?? entry.assessment ?? {};
    for (const key of ASSESSMENT_KEYS) {
        if (has(explicit, key)) assessment[key] = cloneValue(explicit[key]);
        else if (has(source, key)) assessment[key] = cloneValue(source[key]);
    }
    return assessment;
}

function materialState(entry, overrides) {
    const effectiveMaterial = { ...entry.sourceMaterial, ...overrides };
    const missingFields = [];
    const errors = {};
    for (const { key } of INSTANCE_MATERIAL_FIELDS) {
        if (!has(effectiveMaterial, key) || effectiveMaterial[key] === undefined) {
            missingFields.push(key);
            continue;
        }
        const error = materialError(key, effectiveMaterial[key]);
        if (error) errors[key] = error;
    }
    return Object.freeze({
        id: entry.id,
        name: entry.name,
        count: entry.count,
        sourceMaterial: entry.sourceMaterial,
        overrides: Object.freeze({ ...overrides }),
        effectiveMaterial: Object.freeze(effectiveMaterial),
        upstreamAssessment: entry.upstreamAssessment,
        assessmentNotice: Object.keys(entry.upstreamAssessment).length
            ? 'Upstream uncertainty values remain in their original inference space, not SI error bars; trust is not proof of accuracy.'
            : null,
        missingFields: Object.freeze(missingFields),
        errors: Object.freeze(errors),
        eligible: missingFields.length === 0 && Object.keys(errors).length === 0
    });
}

function normalizePatch(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new TypeError('material override must be an object');
    }
    const normalized = {};
    for (const [name, value] of Object.entries(patch)) {
        const field = FIELD_BY_NAME.get(name);
        if (!field) throw new Error(`unknown material field "${name}"`);
        normalized[field.key] = value;
    }
    return normalized;
}

function materialError(key, value) {
    if (key === 'poissonRatio') {
        return Number.isFinite(value) && value >= POISSON_RANGE.min && value <= POISSON_RANGE.max
            ? null
            : `泊松比必须在 ${POISSON_RANGE.min} 到 ${POISSON_RANGE.max} 之间。`;
    }
    return Number.isFinite(value) && value > 0
        ? null
        : `${key === 'density' ? '密度' : '杨氏模量'}必须是有限正数。`;
}

function requireKnownId(byId, id) {
    if (!Number.isInteger(id) || id <= 0) {
        throw new Error(`selection requires a positive instance ID; received ${id}`);
    }
    if (!byId.has(id)) throw new Error(`unknown instance ID ${id}`);
}

function requireActive(disposed) {
    if (disposed) throw new Error('instance material state has been disposed');
}

function finiteCount(value) {
    return Number.isInteger(value) && value >= 0 ? value : null;
}

function has(value, key) {
    return value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key);
}

function cloneValue(value) {
    if (Array.isArray(value)) return value.map(cloneValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, cloneValue(nested)]));
    }
    return value;
}
