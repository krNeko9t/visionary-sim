import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { connect } from '../browser.mjs';
import { TOLERANCE_RULE, compareConditions, compareRun, recordReference, scriptChanged } from './reference.js';
import { BATCH, SCENARIOS } from './scenarios.js';

// Plays every scenario in an isolated Chrome (WebGPU, --remote-debugging-port)
// against a local Vite server, then either holds the runs against the
// recorded reference or, with --record, records a new one. Owns only the tab
// it opens. See README.md in this directory.
const { values } = parseArgs({ options: {
    cdp: { type: 'string', default: 'http://127.0.0.1:9351' },
    base: { type: 'string', default: 'http://127.0.0.1:5188' },
    output: { type: 'string' },
    record: { type: 'boolean', default: false },
    commit: { type: 'string' },
    repeats: { type: 'string', default: '5' },
    scenario: { type: 'string', multiple: true }
} });
if (!values.output) throw new Error('--output <directory> is required');
if (values.record && !values.commit) throw new Error('--record needs --commit <sim commit the run is on>');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const RECORDED = join(HERE, 'recorded');
const names = values.scenario ?? Object.keys(SCENARIOS);

/** @param {string} text - Base64 float32 bytes. @returns {Float32Array} The floats. */
const decode = text => {
    const bytes = Buffer.from(text, 'base64');
    return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
};
/** @param {Float32Array} positions - Floats. @returns {string} Their bytes, base64. */
const encode = positions => Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength).toString('base64');
const writeJson = (name, value) => writeFileSync(join(values.output, name), JSON.stringify(value, null, 1) + '\n');

/** @returns {Record<string, string>} SHA-256 of every file the scenes can load, by path. */
function assetHashes(dir = join(ROOT, 'public')) {
    return Object.fromEntries(readdirSync(dir).sort().flatMap((entry) => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) return Object.entries(assetHashes(full));
        const path = relative(ROOT, full).replaceAll('\\', '/');
        return [[path, createHash('sha256').update(readFileSync(full)).digest('hex')]];
    }));
}

/** Records every scenario `--repeats` times and writes a reference into `--output`. */
async function record(play, conditions) {
    const repeats = Number(values.repeats);
    for (const name of names) {
        const runs = [];
        for (let r = 0; r < repeats; r++) runs.push(await play(name));
        const { dt, checkpoints } = recordReference(runs);
        const { scene, script } = SCENARIOS[name];
        writeJson(`${name}.json`, {
            scenario: name, scene, script, batch: BATCH, dt, nodes: checkpoints[0].positions.length / 3,
            checkpoints: checkpoints.map(({ step, spread, tolerance, positions }) =>
                ({ step, spread, tolerance, positions: encode(positions) }))
        });
        console.log(`${name}: dt ${dt} s, spread ${checkpoints.map(({ spread }) => spread).join(' / ')} m`);
    }
    writeJson('conditions.json', {
        commit: values.commit, recorded: new Date().toISOString(), repeats, tolerance: TOLERANCE_RULE, ...conditions
    });
    console.log(`RECORDED ${names.join(', ')} into ${values.output}`);
}

/** Holds one run of every scenario against `recorded/`; fails the process on any difference. */
async function compare(play, conditions) {
    const recorded = JSON.parse(readFileSync(join(RECORDED, 'conditions.json'), 'utf8'));
    const { problems, elsewhere } = compareConditions(recorded, conditions);
    const report = {};
    for (const name of names) {
        const file = JSON.parse(readFileSync(join(RECORDED, `${name}.json`), 'utf8'));
        const changed = scriptChanged(file, SCENARIOS[name].script, BATCH);
        if (changed) {
            problems.push(changed);
            continue;
        }
        const reference = { ...file, checkpoints: file.checkpoints.map(c => ({ ...c, positions: decode(c.positions) })) };
        const result = compareRun(reference, await play(name));
        report[name] = result.checkpoints;
        problems.push(...result.problems);
        console.log(`${name}: ${result.checkpoints.map(({ step, distance }) => `step ${step} ${distance} m`).join(', ')}`);
    }
    const { assets, ...environment } = conditions;
    writeJson('comparison.json', {
        recorded: { commit: recorded.commit, browser: recorded.browser, adapter: recorded.adapter, gpu: recorded.gpu },
        now: environment, scenarios: report, problems
    });
    if (problems.length) {
        console.error(`FAIL: the motion differs from the reference.\n\n${[...problems, elsewhere ?? []].flat().join('\n\n')}`);
        process.exitCode = 1;
    } else {
        console.log(`PASS: ${names.join(', ')} reproduce the reference recorded on ${recorded.commit}`);
    }
}

mkdirSync(values.output, { recursive: true });
const browser = await connect(values.cdp, { timeoutMs: 600000 });
const page = await browser.openPage(`${values.base}/test/motion-reference/page.html`);
try {
    if (!await page.waitFor('window.ready === true')) {
        throw new Error('The reference page did not initialise: open test/motion-reference/page.html in this ' +
            'Chrome and read its console -- usually there is no WebGPU adapter.');
    }
    const { gpu } = await browser.send('SystemInfo.getInfo');
    const conditions = {
        browser: browser.version.Browser, adapter: await page.evaluate('adapterInfo()'), gpu: gpu.devices, assets: assetHashes()
    };
    const play = async name => {
        const run = await page.evaluate(`playScenario(${JSON.stringify(name)})`);
        return { ...run, checkpoints: run.checkpoints.map(({ step, positions }) => ({ step, positions: decode(positions) })) };
    };
    await (values.record ? record : compare)(play, conditions);
} finally {
    await page.close();
    browser.close();
}
