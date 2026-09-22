import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';

const dirs = [];
afterEach(() => dirs.splice(0).forEach(p => rmSync(p, { recursive: true, force: true })));
function ply(path, rows, names = Object.keys(rows[0])) {
    const header = Buffer.from(`ply\nformat binary_little_endian 1.0\nelement vertex ${rows.length}\n${names.map(n => `property float ${n}\n`).join('')}end_header\n`);
    const data = Buffer.alloc(rows.length * names.length * 4);
    rows.forEach((row, i) => names.forEach((n, j) => data.writeFloatLE(row[n], (i * names.length + j) * 4)));
    writeFileSync(path, Buffer.concat([header, data]));
}
function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 'calibration-')); dirs.push(dir);
    const gaussian = (x, opacity = 4) => ({ x, y: 0.05, z: 0, opacity,
        scale_0: Math.log(0.025), scale_1: Math.log(0.025), scale_2: Math.log(0.025),
        rot_0: 1, rot_1: 0, rot_2: 0, rot_3: 0, f_dc_0: 0, f_dc_1: 0, f_dc_2: 0 });
    ply(join(dir, 'foreground.ply'), [gaussian(-0.1), gaussian(0.1), gaussian(0.11), gaussian(0.3, -10)]);
    ply(join(dir, 'moving_part_points.ply'), [{ x: 0.1, y: 0.05, z: 0 }]);
    writeFileSync(join(dir, 'report.json'), JSON.stringify({ transform: {
        convention: 'z-up to y-up', rotationRows: [[1,0,0],[0,0,1],[0,-1,0]],
        scaleMetresPerSourceUnit: 1, translationMetres: [0,0,0], referenceHeightMetres: 0.3
    }, up: { maxDeviationDegrees: 0 } }));
    return dir;
}
function run(dir, name = 'out', r = '0.04,0.08', size = '0.04,0.02') {
    return spawnSync(process.execPath, [resolve('tools/calibrate-alocasia.js'), '--input', dir,
        '--output', join(dir, name), '--input-kind', 'synthetic', `--r=${r}`, '--element-sizes', size], { encoding: 'utf8' });
}
it('reports synthetic metric classifications, real proxy samples and reproducible review evidence', () => {
    const dir = fixture();
    const result = run(dir);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.inputKind).toBe('synthetic');
    expect(report.counts).toEqual({ beforeCleaning: 4, afterCleaning: 3, movingSamples: 1 });
    expect(report.semanticCalibration).toBe('not performed');
    expect(report.candidates).toHaveLength(2);
    for (const candidate of report.candidates) {
        expect(candidate.gaussians).toEqual({ movable: 2, fixed: 1 });
        expect(candidate.gaussianClassificationIdentical).toBe(true);
        expect(candidate.resolutions.map(row => row.elementSize)).toEqual([0.04, 0.02]);
        for (const row of candidate.resolutions) {
            expect(row.materialNodes).toBe(row.staticNodes + row.movableNodes);
            expect(row.staticNodes).toBeGreaterThan(0);
            expect(row.movableNodes).toBeGreaterThan(0);
            expect(row.fixedMaterialRatio).toBe(row.staticNodes / row.materialNodes);
            const evidence = readFileSync(join(dir, 'out', row.evidence), 'utf8').trim().split('\n');
            expect(evidence.length).toBe(row.materialNodes + 1);
            for (const line of evidence.slice(1)) {
                const [, x, y, z, isStatic] = line.split(',').map(Number);
                // Independent nearest-foreground material ownership reference.
                const nearest = [-0.1, 0.1, 0.11].map(Math.fround)
                    .sort((a, b) => Math.abs(x - a) - Math.abs(x - b))[0];
                expect(isStatic).toBe(Math.abs(nearest - Math.fround(0.1)) > candidate.r ? 1 : 0);
            }
        }
        const evidence = readFileSync(join(dir, 'out', candidate.evidence), 'utf8');
        expect(evidence.trim().split('\n')).toHaveLength(4);
        expect(evidence).toContain('red,green,blue');
    }
    expect(report.candidates[0].resolutions[0].materialNodes).not.toBe(report.candidates[0].resolutions[1].materialNodes);
    expect(run(dir, 'again').stdout).toBe(result.stdout);
    for (const candidate of report.candidates) for (const name of [candidate.evidence, ...candidate.resolutions.map(row => row.evidence)]) {
        expect(readFileSync(join(dir, 'again', name))).toEqual(readFileSync(join(dir, 'out', name)));
    }
});

it('keeps empty samples, all-static and unsupported candidates as failed evidence', () => {
    const dir = fixture();
    const result = run(dir, 'degenerate', '0,10');
    expect(result.status, result.stderr).toBe(2);
    const report = JSON.parse(result.stdout);
    expect(report.candidates.map(c => c.r)).toEqual([0, 10]);
    // An exactly coincident movable measurement owns surrounding material
    // even at r=0; the proxy's corners need not coincide with the sample.
    expect(report.candidates[0].resolutions.every(row => row.movableNodes > 0)).toBe(true);
    expect(report.candidates[1].resolutions.every(row => row.errors.includes('no fixed material support'))).toBe(true);
    ply(join(dir, 'moving_part_points.ply'), [], ['x', 'y', 'z']);
    const empty = run(dir, 'empty');
    expect(empty.status).toBe(2);
    const candidate = JSON.parse(empty.stdout).candidates[0];
    expect(candidate.errors).toContain('no moving samples');
    expect(candidate.gaussians).toEqual({ movable: 0, fixed: 3 });
    expect(candidate.resolutions.every(row => row.fixedMaterialRatio === 1)).toBe(true);
    expect(readFileSync(join(dir, 'empty', candidate.evidence), 'utf8').trim().split('\n')).toHaveLength(4);
});

it('reports zero material after cleaning without pretending the undefined fixed ratio is zero', () => {
    const dir = fixture();
    const buffer = readFileSync(join(dir, 'foreground.ply'));
    const offset = buffer.indexOf(Buffer.from('end_header\n')) + 'end_header\n'.length;
    for (let i = 0; i < 4; i++) buffer.writeFloatLE(-10, offset + (i * 14 + 3) * 4);
    writeFileSync(join(dir, 'foreground.ply'), buffer);
    const result = run(dir);
    expect(result.status).toBe(2);
    const report = JSON.parse(result.stdout);
    expect(report.counts.afterCleaning).toBe(0);
    for (const row of report.candidates[0].resolutions) {
        expect(row.materialNodes).toBe(0);
        expect(row.fixedMaterialRatio).toBeNull();
        expect(row.errors).toContain('no material nodes');
    }
});

it.each(['negative r', 'nonfinite r', 'one size', 'nonfinite position', 'missing transform'])('records invalid input: %s', failure => {
    const dir = fixture();
    if (failure === 'nonfinite position') ply(join(dir, 'moving_part_points.ply'), [{ x: NaN, y: 0, z: 0 }]);
    if (failure === 'missing transform') writeFileSync(join(dir, 'report.json'), '{}');
    const result = run(dir, 'out', failure === 'negative r' ? '-0.01,0.04' : failure === 'nonfinite r' ? 'NaN,0.04' : '0.04,0.08', failure === 'one size' ? '0.02,0.02' : '0.04,0.02');
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.status).toBe('invalid-input');
    expect(report.errors.length).toBeGreaterThan(0);
    expect(JSON.parse(readFileSync(join(dir, 'out/calibration.json'), 'utf8'))).toEqual(report);
});
