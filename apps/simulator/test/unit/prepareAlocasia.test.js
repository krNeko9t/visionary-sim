import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { readPly } from '../../src/assets/splats/ply.js';
import { createAlocasiaScene } from '../../src/scene/alocasia.js';
import { cloudFromPly } from '../../src/assets/splats/cloud.js';

const temporary = [];
afterEach(() => temporary.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
function ply(path, rows) {
    const names = Object.keys(rows[0]);
    const header = Buffer.from(`ply\nformat binary_little_endian 1.0\nelement vertex ${rows.length}\n${names.map(n => `property float ${n}\n`).join('')}end_header\n`);
    const data = Buffer.alloc(rows.length * names.length * 4);
    rows.forEach((row, i) => names.forEach((n, j) => data.writeFloatLE(row[n], (i * names.length + j) * 4)));
    writeFileSync(path, Buffer.concat([header, data]));
}
function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 'alocasia-'));
    temporary.push(dir);
    const xyz = [{ x: 10, y: 20, z: 30 }, { x: 14, y: 22, z: 32 }];
    const gaussian = p => ({ ...p, f_dc_0: 1, f_dc_1: 2, f_dc_2: 3, opacity: 4,
        scale_0: Math.log(2), scale_1: Math.log(3), scale_2: Math.log(4),
        rot_0: 1, rot_1: 0, rot_2: 0, rot_3: 0, f_rest_0: 7 });
    ply(join(dir, 'clean_object_points.ply'), xyz);
    ply(join(dir, 'moving_part_points.ply'), [xyz[1]]);
    ply(join(dir, 'point_cloud.ply'), [gaussian(xyz[1]), gaussian({ x: 10.009, y: 20, z: 30 }), gaussian({ x: 10.011, y: 20, z: 30 }), gaussian({ x: 100, y: 100, z: 100 })]);
    writeFileSync(join(dir, 'transforms_train.json'), JSON.stringify({ frames: [{ transform_matrix:
        [[1, 0, 0, 1], [0, 0, -1, 2], [0, 1, 0, 3], [0, 0, 0, 1]] }] }));
    return dir;
}
function run(dir) {
    return spawnSync(process.execPath, [resolve('apps/simulator/tools/prepare-alocasia.js'), '--input', dir, '--output', join(dir, 'out'), '--camera-convention', 'opengl-c2w', '--up-threshold-deg', '15'], { encoding: 'utf8' });
}
function read(path) {
    const bytes = readFileSync(path);
    return readPly(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}
it('CLI produces aligned metre assets with transformed Gaussian axes and deterministic reports', () => {
    const dir = fixture();
    const result = run(dir);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.transform.scaleMetresPerSourceUnit).toBe(0.15);
    expect(report.up.maxDeviationDegrees).toBe(0);
    expect(report.up.thresholdDegrees).toBe(15);
    expect(report.transform.translationMetres).toEqual([-1.7999999999999998, -4.5, 3.15]);
    expect(report.boundsMetres.cleanReference.size).toEqual([expect.closeTo(0.6), expect.closeTo(0.3), expect.closeTo(0.3)]);
    expect(report.foregroundDistance.metres).toBe(0.0015);
    expect(report.counts).toEqual({ scene: 4, clean: 2, moving: 1, foreground: 2, background: 2 });
    const foreground = read(join(dir, 'out/foreground.ply'));
    const cloud = cloudFromPly(foreground);
    expect([...cloud.positions.slice(0, 3)]).toEqual([expect.closeTo(0.3), expect.closeTo(0.3), expect.closeTo(-0.15)]);
    expect([...cloud.rotations.slice(0, 4)]).toEqual([expect.closeTo(-Math.SQRT1_2), 0, 0, expect.closeTo(Math.SQRT1_2)]);
    expect([...cloud.scales.slice(0, 3)]).toEqual([expect.closeTo(0.3), expect.closeTo(0.45), expect.closeTo(0.6)]);
    expect([...foreground.properties.f_rest_0]).toEqual([7, 7]);
    const moving = read(join(dir, 'out/moving_part_points.ply'));
    expect(moving.properties.x[0]).toBe(cloud.positions[0]);
    expect(moving.properties.y[0]).toBe(cloud.positions[1]);
    expect(moving.properties.z[0]).toBe(cloud.positions[2]);
    expect(read(join(dir, 'out/background.ply')).count).toBe(2);
    const before = readdirSync(join(dir, 'out')).map(name => [name, readFileSync(join(dir, 'out', name))]);
    expect(run(dir).stdout).toBe(result.stdout);
    before.forEach(([name, data]) => expect(readFileSync(join(dir, 'out', name))).toEqual(data));
});

it.each(['missing poses', 'wrong up', 'invalid pose', 'nonfinite xyz', 'zero height'])('fails closed for %s, including a previously successful output', (failure) => {
    const dir = fixture();
    expect(run(dir).status).toBe(0);
    if (failure === 'missing poses') rmSync(join(dir, 'transforms_train.json'));
    if (failure === 'wrong up') writeFileSync(join(dir, 'transforms_train.json'), JSON.stringify({ frames: [{ transform_matrix: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]] }] }));
    if (failure === 'invalid pose') writeFileSync(join(dir, 'transforms_train.json'), JSON.stringify({ frames: [{ transform_matrix: [[1, 0, 0, 0], [0, 0, -1, 0], [0, 2, 0, 0], [0, 0, 0, 1]] }] }));
    if (failure === 'nonfinite xyz') ply(join(dir, 'moving_part_points.ply'), [{ x: NaN, y: 0, z: 0 }]);
    if (failure === 'zero height') ply(join(dir, 'clean_object_points.ply'), [{ x: 0, y: 0, z: 0 }]);
    const result = run(dir);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/failed/);
    expect(result.stdout).toBe('');
    expect(readdirSync(join(dir, 'out'))).toEqual([]);
});

it('reports nonzero camera up deviation and checks the declared threshold', () => {
    const dir = fixture();
    const angle = Math.PI / 6;
    writeFileSync(join(dir, 'transforms_train.json'), JSON.stringify({ frames: [{ transform_matrix:
        [[1, 0, 0, 0], [0, Math.sin(angle), -Math.cos(angle), 0], [0, Math.cos(angle), Math.sin(angle), 0], [0, 0, 0, 1]] }] }));
    const args = [resolve('apps/simulator/tools/prepare-alocasia.js'), '--input', dir, '--output', join(dir, 'out'), '--camera-convention', 'opengl-c2w', '--up-threshold-deg', '31'];
    const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).up.maxDeviationDegrees).toBeCloseTo(30);
    expect(run(dir).stderr).toMatch(/exceeds threshold 15/);
    expect(readdirSync(join(dir, 'out'))).toEqual([]);
});


it('invalidates the success report and continues cleanup when an old asset becomes a directory', () => {
    const dir = fixture();
    expect(run(dir).status).toBe(0);
    const foreground = join(dir, 'out/foreground.ply');
    rmSync(foreground);
    mkdirSync(foreground);
    const result = run(dir);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/alocasia preparation failed:.*EISDIR/);
    expect(result.stderr).toContain('foreground.ply');
    expect(readdirSync(join(dir, 'out'))).toEqual(['foreground.ply']);
});


it('loads all prepared partitions through the real runtime loader without a second transform', async () => {
    const dir = fixture();
    expect(run(dir).status).toBe(0);
    const fetchAsset = vi.fn(async url => {
        const bytes = readFileSync(join(dir, 'out', url.split('/').at(-1)));
        return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    });
    vi.stubGlobal('fetch', fetchAsset);
    try {
        const scene = createAlocasiaScene({ r: 0.002 }); // Synthetic coordinates only.
        const [[{ body, render }], [fixed, background]] = await Promise.all([scene.createObjects(), scene.scenery()]);
        expect(fetchAsset).toHaveBeenCalledTimes(3);
        expect(scene.counts).toMatchObject({ inputForeground: 2, inputBackground: 2, foregroundDiscarded: 0,
            backgroundDiscarded: 0, movableGaussians: 1, fixedGaussians: 1, backgroundGaussians: 2 });
        const foregroundAsset = cloudFromPly(read(join(dir, 'out/foreground.ply')));
        const backgroundAsset = cloudFromPly(read(join(dir, 'out/background.ply')));
        const { colors: _colors, ...physicalForeground } = foregroundAsset;
        expect(body.source.cloud).toEqual(physicalForeground);
        expect(background.cloud).toEqual(backgroundAsset);
        for (const [key, stride] of Object.entries({ positions: 3, rotations: 4, scales: 3, colors: 3, opacity: 1 })) {
            expect(render.cloud[key]).toEqual(foregroundAsset[key].slice(0, stride));
            expect(fixed.cloud[key]).toEqual(foregroundAsset[key].slice(stride));
        }
        expect([...background.cloud.positions]).toEqual([
            expect.closeTo(-0.29835), 0, expect.closeTo(0.15),
            expect.closeTo(13.2), expect.closeTo(10.5), expect.closeTo(-11.85)
        ]);
        expect([...background.cloud.rotations.slice(0, 4)]).toEqual([
            expect.closeTo(-Math.SQRT1_2), 0, 0, expect.closeTo(Math.SQRT1_2)
        ]);
        expect([...background.cloud.scales.slice(0, 3)]).toEqual([expect.closeTo(0.3), expect.closeTo(0.45), expect.closeTo(0.6)]);
        expect(scene.bounds.max[0]).toBeLessThan(1);
        expect(scene.viewBounds.max[0]).toBeCloseTo(13.2);
    } finally { vi.unstubAllGlobals(); }
});

it('uses the same generic CLI for alocasia and isolates synthetic preparation declarations', async () => {
    const { preparePhysDreamer } = await import('../../tools/preparePhysDreamer.js');
    const { ALOCASIA } = await import('../../src/scene/physdreamerDeclarations.js');
    const dir = fixture();
    const legacy = run(dir);
    expect(legacy.status, legacy.stderr).toBe(0);
    const generic = spawnSync(process.execPath, [resolve('apps/simulator/tools/prepare-physdreamer.js'), '--scene', 'alocasia', '--input', dir,
        '--output', join(dir, 'generic'), '--camera-convention', 'opengl-c2w', '--up-threshold-deg', '15'], { encoding: 'utf8' });
    expect(generic.status, generic.stderr).toBe(0);
    expect(JSON.parse(generic.stdout)).toEqual(JSON.parse(legacy.stdout));
    const a = preparePhysDreamer({ input: dir, output: join(dir, 'a'), 'camera-convention': 'opengl-c2w' }, { ...ALOCASIA, name: 'synthetic-a' });
    const b = preparePhysDreamer({ input: dir, output: join(dir, 'b'), 'camera-convention': 'opengl-c2w' },
        { ...ALOCASIA, name: 'synthetic-b', preparation: { ...ALOCASIA.preparation, heightMetres: 0.6 } });
    expect(a.transform.scaleMetresPerSourceUnit).toBe(0.15);
    expect(b.transform.scaleMetresPerSourceUnit).toBe(0.3);
    expect(JSON.parse(readFileSync(join(dir, 'a/report.json'))).scene).toBe('synthetic-a');
    expect(a.inputs['point_cloud.ply']).toMatchObject({ path: join(dir, 'point_cloud.ply'), sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(a.scaleStatus).toContain('not a measured');
    const original = readFileSync(join(dir, 'moving_part_points.ply'));
    expect(() => preparePhysDreamer({ input: dir, output: dir }, ALOCASIA)).toThrow(/must differ/);
    expect(readFileSync(join(dir, 'moving_part_points.ply'))).toEqual(original);
});
