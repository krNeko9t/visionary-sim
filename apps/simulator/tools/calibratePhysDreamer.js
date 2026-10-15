import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { physdreamerDeclaration } from '../src/scene/physdreamerDeclarations.js';

// The CPU discretisation's module graph also carries shader text. Load that
// text using the same ?raw contract as Vite; no device or shader is executed.
registerHooks({ load(url, context, nextLoad) {
    if (url.endsWith('.wgsl?raw')) return { format: 'module', shortCircuit: true,
        source: `export default ${JSON.stringify(readFileSync(new URL(url.split('?')[0]), 'utf8'))};` };
    return nextLoad(url, context);
} });

export async function runCalibrateCli(defaultScene) {
    let name = defaultScene;
    let report;
    try {
        const { values } = parseArgs({ options: {
            scene: { type: 'string' }, input: { type: 'string' }, output: { type: 'string' },
            'input-kind': { type: 'string' }, r: { type: 'string' }, 'element-sizes': { type: 'string' }
        } });
        name = values.scene ?? defaultScene;
        report = await calibratePhysDreamer(values, physdreamerDeclaration(name));
    } catch (error) {
        report = { scene: name ?? null, status: 'invalid-input', errors: [`${name ?? 'PhysDreamer'}: ${error.message}`] };
    }
    process.exitCode = report.status === 'invalid-input' ? 1 : report.status === 'degenerate-candidates' ? 2 : 0;
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

/** CPU-only shared classification and real proxy evidence, never an r selector. */
export async function calibratePhysDreamer(values, declaration) {
    const report = { scene: declaration.name, declaration, schemaVersion: 2,
        materialBoundary: 'nearest-clean-foreground-label',
        semanticCalibration: 'not performed', candidates: [], errors: [] };
    let output;
    try {
        report.request = { ...values };
        delete report.arguments;
        if (typeof declaration.requireFixedMaterial !== 'boolean') throw new Error('explicit requireFixedMaterial is required');
        if (!values.input || !values.output) throw new Error('--input and --output are required');
        // A fresh directory prevents stale evidence being read as this run's result.
        mkdirSync(resolve(values.output));
        output = resolve(values.output);
        report.inputKind = values['input-kind'];
        if (!['synthetic', 'real'].includes(report.inputKind)) throw new Error('--input-kind must explicitly be synthetic or real');
        const radii = list(values.r, '--r', 1, true);
        const sizes = list(values['element-sizes'], '--element-sizes', 2, false);
        // Output location is not input provenance; keep repeated reports identical.
        delete report.request.output;
        const { readPly } = await import('../src/assets/splats/ply.js');
        const { cloudFromPly, restCloud } = await import('../src/assets/splats/cloud.js');
        const { preparePhysDreamerData, materialFailure } = await import('../src/scene/physdreamerData.js');
        const { SoftBody } = await import('visionary-sim/body/softBody.js');
        const { discretizeBody } = await import('visionary-sim/sim/discretize/discretize.js');
        const { staticNodesInRegion } = await import('visionary-sim/sim/staticPrescription.js');
        const { materialCounts } = await import('visionary-sim/sim/state/materialCounts.js');
        report.inputs = {};
        const read = name => {
            const bytes = readFileSync(join(resolve(values.input), name));
            report.inputs[name] = { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
            return bytes;
        };
        const preparation = JSON.parse(read('report.json').toString());
        if (preparation.scene && preparation.scene !== declaration.name) throw new Error(`preparation scene ${preparation.scene} differs from ${declaration.name}`);
        const t = preparation.transform;
        if (!t || !Number.isFinite(t.scaleMetresPerSourceUnit) || t.scaleMetresPerSourceUnit <= 0 ||
            !Array.isArray(t.translationMetres) || t.translationMetres.length !== 3 || !t.translationMetres.every(Number.isFinite) ||
            !Array.isArray(t.rotationRows) || t.rotationRows.length !== 3 || t.rotationRows.some(row => !Array.isArray(row) || row.length !== 3 || !row.every(Number.isFinite))) {
            throw new Error('preparation report requires a finite common metric transform declaration');
        }
        report.preparation = preparation;
        const parse = name => { const b = read(name); return readPly(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
        const foreground = parse('foreground.ply');
        const moving = parse('moving_part_points.ply');
        for (const [label, data] of [['foreground', foreground], ['moving', moving]]) {
            for (const axis of ['x', 'y', 'z']) if (!data.properties[axis]) throw new Error(`${label}: missing ${axis}`);
            for (const [name, array] of Object.entries(data.properties)) if (!array.every(Number.isFinite)) throw new Error(`${label}: non-finite ${name}`);
        }
        const raw = cloudFromPly(foreground);
        for (const [name, array] of Object.entries(raw)) if (ArrayBuffer.isView(array) && !array.every(Number.isFinite)) throw new Error(`foreground: invalid activated ${name}`);
        if (!raw.scales.every(v => v > 0)) throw new Error('foreground: scales must be positive');
        const samples = new Float32Array(moving.count * 3);
        for (let i = 0; i < moving.count; i++) samples.set(['x', 'y', 'z'].map(axis => moving.properties[axis][i]), i * 3);
        report.notes = [
            'All coordinates and r are metres in the supplied common transformed world; no transform is reapplied.',
            'Fixed ratio increasing can mean r is too small. Counts alone cannot establish semantic separation.',
            'Foreground centres are labelled by distance to moving samples. Proxy nodes inherit the nearest clean foreground label; empty proxy thickness is not fixed material.',
            'Inspect moving and fixed foreground boundaries for every candidate; if none separates them, reopen the region decision. No second radius or semantic patch.',
            'CSV red = static, green = movable. Gaussian IDs index the cleaned foreground; node IDs are local to each resolution.'
        ];
        for (const [c, r] of radii.entries()) {
            const { cloud, region, movable, fixed } = preparePhysDreamerData(raw, samples, r);
            report.counts = { beforeCleaning: raw.count, afterCleaning: cloud.count, movingSamples: moving.count };
            const labels = classify(cloud.positions, region);
            const candidate = { r, gaussians: { movable: movable.count, fixed: fixed.count },
                evidence: `candidate-${c}-gaussians.csv`, gaussianClassificationIdentical: true, resolutions: [], errors: [] };
            report.candidates.push(candidate);
            writeEvidence(candidate.evidence, cloud.positions, labels);
            if (!moving.count) candidate.errors.push('no moving samples');
            if (!cloud.count) candidate.errors.push('no foreground after cleaning');
            for (const elementSize of sizes) {
                const row = { elementSize, r, errors: [] };
                candidate.resolutions.push(row);
                // Re-evaluate all centres for each precision rather than comparing counts.
                const repeated = classify(cloud.positions, region);
                const identical = repeated.every((v, i) => v === labels[i]);
                candidate.gaussianClassificationIdentical &&= identical;
                row.gaussianClassificationIdentical = identical;
                if (!cloud.count) {
                    Object.assign(row, { materialNodes: 0, staticNodes: 0, movableNodes: 0, fixedMaterialRatio: null });
                    row.errors.push('no material nodes'); continue;
                }
                try {
                    const body = new SoftBody({ name: declaration.name, source: { kind: 'cloud', cloud: restCloud(cloud) }, staticRegion: region.staticRegion, elementSize });
                    const { dof } = discretizeBody(body);
                    const staticSet = new Set(staticNodesInRegion(dof.restPositions, body.staticRegion));
                    Object.assign(row, materialCounts(dof.invMass, staticSet));
                    row.fixedMaterialRatio = row.materialNodes ? row.staticNodes / row.materialNodes : null;
                    row.evidence = `candidate-${c}-nodes-${candidate.resolutions.length - 1}.csv`;
                    writeEvidence(row.evidence, dof.restPositions, classify(dof.restPositions, region), dof.invMass);
                    const reason = materialFailure(row, declaration.requireFixedMaterial);
                    if (reason) row.errors.push(reason);
                } catch (error) { row.errors.push(error.message); }
            }
        }
        report.status = report.candidates.some(c => c.errors.length || c.resolutions.some(row => row.errors.length)) ? 'degenerate-candidates' : 'numerical-report-only';

    } catch (error) {
        report.status = 'invalid-input';
        report.errors.push(`${declaration.name}: ${error.message}`);
    }
    const json = JSON.stringify(report, null, 2) + '\n';
    if (output) writeFileSync(join(output, 'calibration.json'), json);
    return report;
    function writeEvidence(name, positions, labels, mass) {
        const lines = ['id,x,y,z,static,red,green,blue'];
        labels.forEach((movable, i) => {
            if (mass && !(mass[i] > 0)) return;
            lines.push(`${i},${positions[i * 3]},${positions[i * 3 + 1]},${positions[i * 3 + 2]},${movable ? 0 : 1},${movable ? '0,220,80' : '240,40,40'}`);
        });
        writeFileSync(join(output, name), lines.join('\n') + '\n');
    }

}

function list(value, name, minimum, allowZero) {
    const parts = value?.split(',');
    const numbers = parts?.map(Number);
    if (!parts || parts.some(p => !p.trim()) || numbers.some(n => !Number.isFinite(n) || (allowZero ? n < 0 : n <= 0)) || new Set(numbers).size < minimum) {
        throw new Error(`${name} requires at least ${minimum} distinct finite ${allowZero ? 'non-negative' : 'positive'} metre values`);
    }
    return [...new Set(numbers)];
}
function classify(positions, region) {
    return Array.from({ length: positions.length / 3 }, (_, i) => region.movable(...positions.subarray(i * 3, i * 3 + 3)));
}
