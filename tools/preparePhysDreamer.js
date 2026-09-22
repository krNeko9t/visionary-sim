import { readFileSync, writeFileSync, mkdirSync, rmSync, renameSync, mkdtempSync, existsSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { physdreamerDeclaration } from '../src/scene/physdreamerDeclarations.js';
import { checkPhysDreamerUp } from './physdreamerUp.js';
import { readPly } from '../src/assets/splats/ply.js';
import { REQUIRED_PROPERTIES } from '../src/assets/splats/cloud.js';
import { CONVENTIONS } from '../src/assets/splats/place.js';
import { createMetricRegion } from '../src/scene/metricRegion.js';

// Usage and file/coordinate contracts live in tools/README.md.
const OUTPUTS = ['foreground.ply', 'moving_part_points.ply', 'background.ply', 'report.json'];
export function runPrepareCli(defaultScene) {
    let name = defaultScene;
    try {
        const { values } = parseArgs({ options: {
            scene: { type: 'string' }, input: { type: 'string' }, output: { type: 'string' },
            'camera-convention': { type: 'string' }, 'up-threshold-deg': { type: 'string' },
            'up-mode': { type: 'string' }, 'up-reason': { type: 'string' }
        } });
        name = values.scene ?? defaultScene;
        const report = preparePhysDreamer(values, physdreamerDeclaration(name));
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    } catch (error) {
        console.error(`${name ?? 'PhysDreamer'} preparation failed: ${error.message}`);
        process.exitCode = 1;
    }
}

/** Publish a common metric transform; inputs remain read-only, report is last. */
export function preparePhysDreamer(values, declaration) {
    let output, staging;
    try {
        if (!values.input) throw new Error('--input is required');
        const input = resolve(values.input);
        const candidate = resolve(values.output ?? `public${declaration.assetRoot}`);
        const sameDirectory = existsSync(input) && existsSync(candidate) && realpathSync(input) === realpathSync(candidate);
        if (sameDirectory) throw new Error('input and output directories must differ');
        output = candidate;
        if (input === output) { output = undefined; throw new Error('input and output directories must differ'); }
        // Remove only our named outputs; unrelated files never belong to this command.
        // Invalidate a previous run before validation, so a failed rerun cannot look successful.
        clearOutputs();
        if (values['camera-convention'] !== 'opengl-c2w') throw new Error('--camera-convention opengl-c2w is required');
        const config = declaration.preparation;
        if (!(config.heightMetres > 0) || !Number.isFinite(config.heightMetres) || !(config.foregroundDistanceSource >= 0) || !Number.isFinite(config.foregroundDistanceSource)) throw new Error('invalid preparation scale or foreground distance');
        const inputs = {};
        const inputNames = ['transforms_train.json', 'point_cloud.ply', 'clean_object_points.ply', 'moving_part_points.ply'];
        for (const name of inputNames) {
            const path = join(input, name), bytes = readFileSync(path);
            inputs[name] = { path: realpathSync(path), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
        }
        const threshold = values['up-threshold-deg'] === undefined ? config.upThresholdDegrees : Number(values['up-threshold-deg']);
        const mode = values['up-mode'] ?? config.upMode;
        const changedCheck = mode !== config.upMode || threshold !== config.upThresholdDegrees;
        const up = checkPhysDreamerUp(JSON.parse(readFileSync(join(input, 'transforms_train.json'), 'utf8')), {
            mode, thresholdDegrees: threshold, reason: values['up-reason'] ?? (changedCheck ? 'Explicit CLI observation envelope override; requires source-view review.' : config.upReason)
        });
        const scene = readPoints(join(input, 'point_cloud.ply'), false);
        const clean = readPoints(join(input, 'clean_object_points.ply'), true);
        const moving = readPoints(join(input, 'moving_part_points.ply'), true);
        if (!scene.count || !clean.count || !moving.count) throw new Error('scene, clean and moving inputs must be nonempty');
        for (const name of REQUIRED_PROPERTIES) if (!scene.properties[name]) throw new Error(`scene is missing Gaussian property ${name}`);
        const reference = bounds(clean);
        const height = reference.size[2]; // R(x,y,z)=(x,z,-y), hence oriented height is source z extent.
        if (!(height > 0)) throw new Error('clean foreground reference height must be positive');
        const scale = config.heightMetres / height;
        const boundsSource = { scene: bounds(scene), clean: reference, moving: bounds(moving) };
        const translation = [-(reference.min[0] + reference.max[0]) / 2 * scale,
            -reference.min[2] * scale, (reference.min[1] + reference.max[1]) / 2 * scale];
        for (const cloud of [scene, clean, moving]) transform(cloud, scale, translation);
        const distance = config.foregroundDistanceSource * scale;
        const region = createMetricRegion(xyz(clean), distance);
        const foreground = [], background = [];
        const p = scene.properties;
        for (let i = 0; i < scene.count; i++) (region.movable(p.x[i], p.y[i], p.z[i]) ? foreground : background).push(i);
        if (!foreground.length) throw new Error('distance split produced no foreground');
        const report = {
            schemaVersion: 2, scene: declaration.name, inputs, boundsSource,
            declaration: { ...declaration, preparation: { ...config, upMode: mode, upThresholdDegrees: threshold, upReason: up.reason } },
            scaleStatus: 'artificial simulation scale, not a measured dataset dimension',
            up,
            transform: { convention: 'z-up to y-up', rotationXyzw: CONVENTIONS['z-up'],
                rotationRows: [[1, 0, 0], [0, 0, 1], [0, -1, 0]], scaleMetresPerSourceUnit: scale,
                translationMetres: translation, referenceHeightMetres: config.heightMetres, referenceHeightSource: height },
            foregroundDistance: { sourceUnits: config.foregroundDistanceSource, metres: distance, status: 'pending real-asset review; distinct from movable-region r' },
            counts: { scene: scene.count, clean: clean.count, moving: moving.count, foreground: foreground.length, background: background.length },
            boundsMetres: { cleanReference: bounds(clean), foreground: bounds(scene, foreground), room: bounds(scene), background: bounds(scene, background) },
            outputs: { foreground: 'foreground.ply', moving: 'moving_part_points.ply', background: 'background.ply' }
        };
        const json = JSON.stringify(report, null, 2) + '\n';
        mkdirSync(output, { recursive: true });
        staging = mkdtempSync(join(output, '.prepare-'));
        writePly(join(staging, OUTPUTS[0]), scene, foreground);
        writePly(join(staging, OUTPUTS[1]), moving);
        writePly(join(staging, OUTPUTS[2]), scene, background);
        writeFileSync(join(staging, 'report.json'), json);
        for (const name of OUTPUTS) renameSync(join(staging, name), join(output, name));
        rmSync(staging, { recursive: true });
        return report;
    } catch (error) {
        try { clearOutputs(); } catch { /* preserve the original failure */ }
        try { if (staging) rmSync(staging, { recursive: true, force: true }); } catch (cleanupError) {
            console.error(`temporary output cleanup failed: ${cleanupError.message}`);
        }
        throw error;
    }
    function clearOutputs() {
        if (!output) return;
        // A report certifies a complete publication: invalidate it before touching
        // assets, while publication above deliberately leaves it until last.
        // Keep removing other files after an error without recursively deleting an
        // unexpected directory. Report the first real filesystem failure afterward.
        let firstError;
        for (const name of ['report.json', ...OUTPUTS.filter(name => name !== 'report.json')]) {
            try { rmSync(join(output, name), { force: true }); }
            catch (error) { firstError ??= error; }
        }
        if (firstError) throw firstError;
    }
}

function readPoints(path, onlyXyz) {
    const bytes = readFileSync(path);
    const cloud = readPly(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), onlyXyz ? { properties: ['x', 'y', 'z'] } : {});
    if (!Number.isSafeInteger(cloud.count)) throw new Error('invalid PLY count');
    for (const name of ['x', 'y', 'z']) if (!cloud.properties[name]) throw new Error(`missing ${name} in ${path}`);
    for (const [name, values] of Object.entries(cloud.properties)) for (const v of values) if (!Number.isFinite(v)) throw new Error(`non-finite ${name} in ${path}`);
    // Work in doubles until file output, avoiding a float rounding between transform and distance query.
    cloud.properties = Object.fromEntries(Object.entries(cloud.properties).map(([name, values]) => [name, Float64Array.from(values)]));
    return cloud;
}
function transform({ count, properties: p }, scale, t) {
    const [ax, ay, az, aw] = CONVENTIONS['z-up'];
    for (let i = 0; i < count; i++) {
        const x = p.x[i], y = p.y[i], z = p.z[i];
        p.x[i] = x * scale + t[0]; p.y[i] = z * scale + t[1]; p.z[i] = -y * scale + t[2];
        if (!p.rot_0) continue;
        const w = p.rot_0[i], qx = p.rot_1[i], qy = p.rot_2[i], qz = p.rot_3[i];
        const norm = Math.hypot(w, qx, qy, qz);
        if (!(norm > 0)) throw new Error(`zero Gaussian quaternion at ${i}`);
        p.rot_0[i] = (aw * w - ax * qx - ay * qy - az * qz) / norm;
        p.rot_1[i] = (aw * qx + ax * w + ay * qz - az * qy) / norm;
        p.rot_2[i] = (aw * qy - ax * qz + ay * w + az * qx) / norm;
        p.rot_3[i] = (aw * qz + ax * qy - ay * qx + az * w) / norm;
        for (let j = 0; j < 3; j++) {
            p[`scale_${j}`][i] += Math.log(scale);
            const activated = Math.fround(Math.exp(p[`scale_${j}`][i]));
            if (!(activated > 0) || !Number.isFinite(activated)) throw new Error(`invalid Gaussian scale at ${i}`);
        }
        if (p.nx && p.ny && p.nz) { const ny = p.ny[i]; p.ny[i] = p.nz[i]; p.nz[i] = -ny; }
    }
}
function xyz({ count, properties: p }) {
    const values = new Float64Array(count * 3);
    for (let i = 0; i < count; i++) values.set([p.x[i], p.y[i], p.z[i]], i * 3);
    return values;
}
function bounds({ count, properties: p }, indices) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const visit = i => ['x', 'y', 'z'].forEach((name, j) => { min[j] = Math.min(min[j], p[name][i]); max[j] = Math.max(max[j], p[name][i]); });
    if (indices) indices.forEach(visit); else for (let i = 0; i < count; i++) visit(i);
    return min[0] === Infinity ? null : { min, max, size: max.map((v, j) => v - min[j]) };
}
function writePly(path, { count, properties }, indices) {
    const names = Object.keys(properties);
    const n = indices ? indices.length : count;
    const header = Buffer.from(`ply\nformat binary_little_endian 1.0\nelement vertex ${n}\n${names.map(name => `property float ${name}\n`).join('')}end_header\n`);
    const bytes = Buffer.alloc(n * names.length * 4);
    for (let i = 0; i < n; i++) names.forEach((name, j) => {
        const value = properties[name][indices ? indices[i] : i];
        if (!Number.isFinite(Math.fround(value))) throw new Error(`output ${name} is not representable as float32`);
        bytes.writeFloatLE(value, (i * names.length + j) * 4);
    });
    writeFileSync(path, Buffer.concat([header, bytes]));
}
