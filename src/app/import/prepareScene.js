import { readPly } from '../../assets/splats/ply.js';
import { writeUnitQuat } from '../../assets/splats/cloud.js';
import { POISSON_RANGE } from '../../body/material.js';
import { readNpz } from './npz.js';

const BASE_FIELDS = [
    'x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity',
    'scale_0', 'scale_1', 'rot_0', 'rot_1', 'rot_2', 'rot_3'
];
const SH_FIELDS = Array.from({ length: 45 }, (_, i) => `f_rest_${i}`);
const PLY_FIELDS = [...BASE_FIELDS, ...SH_FIELDS];
const MATERIAL_FIELDS = [
    ['rho_si', value => Number.isFinite(value) && value > 0],
    ['E_si', value => Number.isFinite(value) && value > 0],
    ['nu_si', value => Number.isFinite(value) && value >= POISSON_RANGE.min && value <= POISSON_RANGE.max]
];

/** Turn the three upstream files into a render-ready, still-unsimulated scene. */
export async function prepareSceneImport({ geometryBuffer, labelsBuffer, physicsText, onProgress = () => {} }) {
    onProgress({ phase: 'geometry', message: '解码 PLY 几何' });
    let ply;
    try {
        ply = readPly(geometryBuffer, { properties: PLY_FIELDS, exactLength: true });
        validatePlyTypes(ply.propertyTypes);
    } catch (error) {
        throw sourceError('geometry', 'point_cloud.ply', error);
    }

    onProgress({ phase: 'labels', message: '解码 NPZ/NPY 标签', counts: { gaussians: ply.count } });
    let archive;
    try {
        archive = await readNpz(labelsBuffer);
    } catch (error) {
        throw sourceError('labels', 'labels.npz', error);
    }
    const labelsArray = requiredArray(archive, 'labels', '<i4');
    const validArray = requiredArray(archive, 'valid', '|b1');
    const labels = labelsArray.data;
    const valid = validArray.data;
    validateOneDimensional(labelsArray, 'labels.npy');
    validateOneDimensional(validArray, 'valid.npy');
    if (labels.length !== ply.count) {
        throw new Error(`labels.npy: 数组长度 ${labels.length} 与 PLY 原始行数 ${ply.count} 不一致`);
    }
    if (valid.length !== ply.count) {
        throw new Error(`valid.npy: 数组长度 ${valid.length} 与 PLY 原始行数 ${ply.count} 不一致`);
    }

    const counts = new Map();
    for (let i = 0; i < ply.count; i++) {
        const id = labels[i];
        if (id < 0) throw new Error(`labels.npy: 第 ${i} 行含负实例 ID ${id}`);
        if (Boolean(valid[i]) !== (id > 0)) {
            throw new Error(`valid.npy: 第 ${i} 行与 labels > 0 的关系矛盾`);
        }
        counts.set(id, (counts.get(id) ?? 0) + 1);
    }

    onProgress({ phase: 'physics', message: '校验实例物性', counts: { gaussians: ply.count, instances: positiveIds(counts).length } });
    const physics = parsePhysics(physicsText, counts);
    const reference = sceneReference(ply.properties, ply.count);

    onProgress({ phase: 'indexing', message: '按原始行建立显示与实例索引', counts: { gaussians: ply.count, instances: positiveIds(counts).length } });
    const groups = buildGroups(ply.properties, labels, valid, counts, physics);
    const instances = groups.filter(group => group.id > 0).map(group => ({
        id: group.id,
        name: group.name,
        count: group.count,
        rawRows: group.rawRows,
        material: group.material
    }));
    return {
        count: ply.count,
        dimensionality: 2,
        labels,
        valid,
        groups,
        instances,
        untrackedCount: counts.get(0) ?? 0,
        reference,
        simulationBodies: 0,
        sourceNotice: '结构检查不能证明三个同规模文件同源；请用实例着色核查。'
    };
}

function validatePlyTypes(types) {
    for (const name of PLY_FIELDS) {
        if (!['float', 'float32'].includes(types[name])) {
            throw new Error(`属性 ${name} 必须是 float32，实际为 ${types[name] ?? '缺失'}`);
        }
    }
    if ('scale_2' in types) throw new Error('输入含 scale_2；本工作台此槽要求已确认的两轴 2DGS PLY');
}

function requiredArray(archive, name, dtype) {
    const array = archive.get(name);
    if (!array) throw new Error(`labels.npz: 缺少 ${name}.npy`);
    if (array.dtype !== dtype) throw new Error(`${name}.npy: dtype 必须是 ${dtype}，实际为 ${array.dtype}`);
    return array;
}

function validateOneDimensional(array, name) {
    if (array.fortranOrder) throw new Error(`${name}: 必须是 C 顺序`);
    if (array.shape.length !== 1) throw new Error(`${name}: shape 必须是一维，实际为 (${array.shape.join(',')})`);
}

function parsePhysics(text, counts) {
    let value;
    try {
        value = typeof text === 'string' ? JSON.parse(text) : text;
    } catch (error) {
        throw sourceError('physics', 'instance_physics.json', error);
    }
    if (!value || typeof value !== 'object' || !Array.isArray(value.rows)) {
        throw new Error('instance_physics.json: 根对象必须包含 rows 数组');
    }
    const rows = new Map();
    for (const row of value.rows) {
        const id = row?.instance_id;
        if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`instance_physics.json: 非法 instance_id ${String(id)}`);
        if (rows.has(id)) throw new Error(`instance_physics.json: instance_id ${id} 重复`);
        if (!counts.has(id)) throw new Error(`instance_physics.json: instance_id ${id} 不在 labels.npy 中`);
        if (row.n_gau !== undefined && (!Number.isSafeInteger(row.n_gau) || row.n_gau < 0)) {
            throw new Error(`instance_physics.json: instance_id ${id} 的 n_gau 非法`);
        }
        if (row.n_gau !== undefined && row.n_gau !== counts.get(id)) {
            throw new Error(`instance_physics.json: instance_id ${id} 的 n_gau=${row.n_gau}，与标签计数 ${counts.get(id)} 不一致`);
        }
        rows.set(id, row);
    }
    const names = value.meta?.names;
    if (names !== undefined && (!names || typeof names !== 'object' || Array.isArray(names))) {
        throw new Error('instance_physics.json: meta.names 必须是对象');
    }
    return { rows, names: names ?? {} };
}

function sceneReference(properties, count) {
    if (count === 0) throw new Error('point_cloud.ply: 场景没有高斯行');
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const fields = ['x', 'y', 'z'];
    for (let i = 0; i < count; i++) {
        for (let axis = 0; axis < 3; axis++) {
            const value = properties[fields[axis]][i];
            if (!Number.isFinite(value)) throw new Error(`point_cloud.ply: 第 ${i} 行 ${fields[axis]} 不是有限数`);
            min[axis] = Math.min(min[axis], value);
            max[axis] = Math.max(max[axis], value);
        }
    }
    const longestSide = Math.max(...min.map((value, axis) => max[axis] - value));
    if (!(longestSide > 0) || !Number.isFinite(longestSide)) throw new Error('point_cloud.ply: 场景范围为空、非有限或最长边为零');
    return { center: min.map((value, axis) => (value + max[axis]) / 2), longestSide, defaultMeters: 1 };
}

function buildGroups(properties, labels, valid, counts, physics) {
    const groups = [...counts.entries()].sort(([a], [b]) => a - b).map(([id, count]) => ({
        id,
        count,
        name: id === 0 ? '未追踪内容' : String(physics.names[id] ?? `实例 ${id}`),
        rawRows: new Uint32Array(count),
        sourceValid: new Uint8Array(count),
        cloud: allocateCloud(count),
        material: id === 0 ? null : materialResult(physics.rows.get(id))
    }));
    const byId = new Map(groups.map(group => [group.id, group]));
    const offsets = new Map(groups.map(group => [group.id, 0]));
    for (let raw = 0; raw < labels.length; raw++) {
        const group = byId.get(labels[raw]);
        const at = offsets.get(group.id);
        group.rawRows[at] = raw;
        group.sourceValid[at] = valid[raw];
        copyCloudRow(properties, raw, group.cloud, at);
        offsets.set(group.id, at + 1);
    }
    return groups;
}

function allocateCloud(count) {
    return {
        count,
        dimensionality: 2,
        positions: new Float32Array(count * 3),
        rotations: new Float32Array(count * 4),
        scales: new Float32Array(count * 3),
        opacity: new Float32Array(count),
        dc: Array.from({ length: 3 }, () => new Float32Array(count)),
        sphericalHarmonics: Array.from({ length: 45 }, () => new Float32Array(count))
    };
}

function copyCloudRow(source, raw, cloud, at) {
    const finite = name => {
        const value = source[name][raw];
        if (!Number.isFinite(value)) throw new Error(`point_cloud.ply: 第 ${raw} 行 ${name} 不是有限数`);
        return value;
    };
    cloud.positions.set([finite('x'), finite('y'), finite('z')], at * 3);
    const scales = [Math.exp(finite('scale_0')), Math.exp(finite('scale_1'))];
    if (scales.some(value => !Number.isFinite(value) || value <= 0 || value > 3.4028234663852886e38)) {
        throw new Error(`point_cloud.ply: 第 ${raw} 行 scale 激活后超出有限 float32 范围`);
    }
    cloud.scales.set([scales[0], scales[1], 0], at * 3);
    cloud.opacity[at] = sigmoid(finite('opacity'));
    const quaternion = ['rot_1', 'rot_2', 'rot_3', 'rot_0'].map(finite);
    if (Math.hypot(...quaternion) === 0) throw new Error(`point_cloud.ply: 第 ${raw} 行 rotation 为零四元数`);
    writeUnitQuat(cloud.rotations, at, ...quaternion);
    for (let channel = 0; channel < 3; channel++) cloud.dc[channel][at] = finite(`f_dc_${channel}`);
    for (let coefficient = 0; coefficient < 45; coefficient++) {
        cloud.sphericalHarmonics[coefficient][at] = finite(`f_rest_${coefficient}`);
    }
}

function materialResult(row) {
    if (!row) return { valid: false, source: null, issues: ['缺少物性记录'] };
    const issues = [];
    for (const [name, valid] of MATERIAL_FIELDS) {
        if (!(name in row)) issues.push(`缺少 ${name}`);
        else if (!valid(row[name])) issues.push(`${name} 非法`);
    }
    return { valid: issues.length === 0, source: row, issues };
}

function sigmoid(value) {
    if (value >= 0) return 1 / (1 + Math.exp(-value));
    const exp = Math.exp(value);
    return exp / (1 + exp);
}

function positiveIds(counts) {
    return [...counts.keys()].filter(id => id > 0);
}

function sourceError(phase, file, error) {
    const wrapped = new Error(`${file}: ${error.message}`);
    wrapped.phase = phase;
    wrapped.file = file;
    wrapped.cause = error;
    return wrapped;
}
