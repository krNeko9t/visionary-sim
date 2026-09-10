import { POISSON_RANGE } from '../body/material.js';
import { fingerprintSourceBuffers } from './import/sourceFingerprint.js';
export { fingerprintSourceBuffers } from './import/sourceFingerprint.js';

export const PREPARATION_CONFIG_VERSION = 1;

const SOURCE_SLOTS = Object.freeze(['geometry', 'labels', 'physics']);
const ROOT_FIELDS = Object.freeze([
    'formatVersion', 'sources', 'calibration', 'container',
    'materialOverrides', 'participantIds'
]);
const CALIBRATION_FIELDS = Object.freeze(['upAxis', 'manualDegrees', 'longestMeters', 'position']);
const CONTAINER_FIELDS = Object.freeze(['position', 'orientation', 'dimensions']);
const FINGERPRINT_FIELDS = Object.freeze(['name', 'sha256']);
const MATERIAL_FIELDS = Object.freeze(['density', 'youngsModulus', 'poissonRatio']);
const UP_AXES = new Set(['+Y', '-Y', '+Z', '-Z', '+X', '-X']);
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const INSTANCE_ID_PATTERN = /^[1-9][0-9]*$/;

/** Read and fingerprint every byte in each required source-file slot. */
export async function fingerprintSourceFiles(files) {
    requireRecord(files, 'source files');
    strictKeys(files, SOURCE_SLOTS, 'source files');
    const entries = await Promise.all(SOURCE_SLOTS.map(async slot => {
        const file = files[slot];
        if (!file || typeof file.arrayBuffer !== 'function') {
            throw new Error(`${slot} source must be a readable file`);
        }
        if (typeof file.name !== 'string' || file.name.length === 0) {
            throw new Error(`${slot} source file name must be a non-empty string`);
        }
        const bytes = await file.arrayBuffer();
        if (!(bytes instanceof ArrayBuffer)) {
            throw new Error(`${slot} source did not provide an ArrayBuffer`);
        }
        return [slot, { name: file.name, bytes }];
    }));
    return fingerprintSourceBuffers(Object.fromEntries(entries));
}

/**
 * Build the serializable preparation artifact from authored state.
 * `instanceIds` is validation context and is deliberately omitted from JSON.
 */
export function createPreparationConfig({
    sources,
    calibration,
    container,
    materialOverrides,
    participantIds,
    instanceIds
}) {
    return validatePreparationConfig({
        formatVersion: PREPARATION_CONFIG_VERSION,
        sources,
        calibration,
        container,
        materialOverrides,
        participantIds
    }, { instanceIds });
}

/** Parse JSON and return a validated, detached, immutable configuration. */
export function parsePreparationConfig(text, options = {}) {
    if (typeof text !== 'string') throw new TypeError('preparation configuration JSON must be a string');
    let value;
    try {
        value = JSON.parse(text);
    } catch (error) {
        throw new Error(`Invalid preparation configuration JSON: ${error.message}`, { cause: error });
    }
    return validatePreparationConfig(value, options);
}

/**
 * Match all three source contents. Names are intentionally ignored. Instance
 * references are checked only after the content identity has matched.
 */
export async function matchPreparationSources(config, files, { instanceIds } = {}) {
    const actual = await fingerprintSourceFiles(files);
    return matchPreparationFingerprints(config, actual, { instanceIds });
}

/** Match digests already computed while reading the import worker's source files. */
export function matchPreparationFingerprints(config, sources, { instanceIds } = {}) {
    const saved = validatePreparationConfig(config);
    const actual = validateSources(sources);
    const mismatchedSlots = SOURCE_SLOTS.filter(slot =>
        saved.sources[slot].sha256 !== actual[slot].sha256
    );
    if (mismatchedSlots.length) return { matched: false, mismatchedSlots };
    validatePreparationConfig(saved, { instanceIds });
    return { matched: true, fingerprints: actual };
}

/** Validate an already-decoded configuration without mutating the input. */
export function validatePreparationConfig(value, { instanceIds } = {}) {
    requireRecord(value, 'preparation configuration');
    strictKeys(value, ROOT_FIELDS, 'preparation configuration');
    requireFields(value, ROOT_FIELDS, 'preparation configuration');
    if (value.formatVersion !== PREPARATION_CONFIG_VERSION) {
        throw new Error(`Unsupported preparation configuration version ${String(value.formatVersion)}`);
    }

    const sources = validateSources(value.sources);
    const calibration = validateCalibration(value.calibration);
    const container = validateContainer(value.container);
    const materialOverrides = validateOverrides(value.materialOverrides);
    const participantIds = validateParticipants(value.participantIds);
    validateReferences(materialOverrides, participantIds, instanceIds);

    return deepFreeze({
        formatVersion: PREPARATION_CONFIG_VERSION,
        sources,
        calibration,
        container,
        materialOverrides,
        participantIds
    });
}

function validateSources(value) {
    requireRecord(value, 'sources');
    strictKeys(value, SOURCE_SLOTS, 'sources');
    requireFields(value, SOURCE_SLOTS, 'sources');
    return Object.fromEntries(SOURCE_SLOTS.map(slot => {
        const fingerprint = value[slot];
        requireRecord(fingerprint, `${slot} source fingerprint`);
        strictKeys(fingerprint, FINGERPRINT_FIELDS, `${slot} source fingerprint`);
        requireFields(fingerprint, FINGERPRINT_FIELDS, `${slot} source fingerprint`);
        if (typeof fingerprint.name !== 'string' || fingerprint.name.length === 0) {
            throw new Error(`${slot} source fingerprint name must be a non-empty string`);
        }
        if (typeof fingerprint.sha256 !== 'string' || !SHA256_PATTERN.test(fingerprint.sha256)) {
            throw new Error(`${slot} source fingerprint sha256 must be 64 lowercase hexadecimal characters`);
        }
        return [slot, { name: fingerprint.name, sha256: fingerprint.sha256 }];
    }));
}

function validateCalibration(value) {
    requireRecord(value, 'calibration');
    strictKeys(value, CALIBRATION_FIELDS, 'calibration');
    requireFields(value, CALIBRATION_FIELDS, 'calibration');
    if (!UP_AXES.has(value.upAxis)) throw new Error(`unknown source up axis "${String(value.upAxis)}"`);
    if (!Number.isFinite(value.longestMeters) || value.longestMeters <= 0) {
        throw new Error('calibration longestMeters must be a positive finite number');
    }
    return {
        upAxis: value.upAxis,
        manualDegrees: finiteVector(value.manualDegrees, 3, 'calibration manualDegrees'),
        longestMeters: value.longestMeters,
        position: finiteVector(value.position, 3, 'calibration position')
    };
}

function validateContainer(value) {
    requireRecord(value, 'container');
    strictKeys(value, CONTAINER_FIELDS, 'container');
    requireFields(value, CONTAINER_FIELDS, 'container');
    const orientation = finiteVector(value.orientation, 4, 'container orientation');
    const length = Math.hypot(...orientation);
    if (!Number.isFinite(length) || Math.abs(length - 1) > 1e-6) {
        throw new Error('container orientation must be a unit quaternion');
    }
    return {
        position: finiteVector(value.position, 3, 'container position'),
        orientation,
        dimensions: positiveVector(value.dimensions, 3, 'container dimensions')
    };
}

function validateOverrides(value) {
    requireRecord(value, 'materialOverrides');
    const result = {};
    for (const [rawId, patch] of Object.entries(value)) {
        const id = parseInstanceId(rawId, 'material override');
        requireRecord(patch, `material override for instance ID ${id}`);
        strictKeys(patch, MATERIAL_FIELDS, `material override for instance ID ${id}`);
        const normalized = {};
        for (const [field, materialValue] of Object.entries(patch)) {
            if (field === 'poissonRatio') {
                if (!Number.isFinite(materialValue) || materialValue < POISSON_RANGE.min || materialValue > POISSON_RANGE.max) {
                    throw new Error(`material override poissonRatio must be between ${POISSON_RANGE.min} and ${POISSON_RANGE.max}`);
                }
            } else if (!Number.isFinite(materialValue) || materialValue <= 0) {
                throw new Error(`material override ${field} must be a positive finite number`);
            }
            normalized[field] = materialValue;
        }
        result[id] = normalized;
    }
    return result;
}

function validateParticipants(value) {
    if (!Array.isArray(value)) throw new Error('participantIds must be an array');
    const seen = new Set();
    return Array.from(value, rawId => {
        const id = positiveSafeInteger(rawId, 'participant instance ID');
        if (seen.has(id)) throw new Error(`duplicate participant instance ID ${id}`);
        seen.add(id);
        return id;
    });
}

function validateReferences(overrides, participantIds, instanceIds) {
    if (instanceIds === undefined) return;
    if (!instanceIds || typeof instanceIds[Symbol.iterator] !== 'function') {
        throw new Error('instanceIds validation context must be iterable');
    }
    const known = new Set();
    for (const rawId of instanceIds) known.add(positiveSafeInteger(rawId, 'source instance ID'));
    const referenced = new Set([
        ...Object.keys(overrides).map(Number),
        ...participantIds
    ]);
    for (const id of referenced) {
        if (!known.has(id)) throw new Error(`instance ID ${id} is not present in the current source`);
    }
}

function parseInstanceId(value, owner) {
    if (!INSTANCE_ID_PATTERN.test(value)) throw new Error(`${owner} key must be a positive instance ID`);
    return positiveSafeInteger(Number(value), `${owner} key`);
}

function positiveSafeInteger(value, name) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer`);
    return value;
}

function finiteVector(value, length, name) {
    if (!Array.isArray(value) || value.length !== length || Array.from(value).some(component => !Number.isFinite(component))) {
        throw new Error(`${name} must contain ${length} finite numbers`);
    }
    return [...value];
}

function positiveVector(value, length, name) {
    const result = finiteVector(value, length, name);
    if (result.some(component => component <= 0)) {
        throw new Error(`${name} must contain ${length} positive finite numbers`);
    }
    return result;
}

function requireRecord(value, name) {
    if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
        throw new Error(`${name} must be a plain object`);
    }
}

function strictKeys(value, allowed, name) {
    const known = new Set(allowed);
    for (const key of Object.keys(value)) {
        if (!known.has(key)) throw new Error(`${name} has unknown field "${key}"`);
    }
}

function requireFields(value, fields, name) {
    for (const field of fields) {
        if (!Object.hasOwn(value, field)) throw new Error(`${name} is missing field "${field}"`);
    }
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}
