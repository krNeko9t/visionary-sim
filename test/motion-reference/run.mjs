import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { connect } from '../cdp.mjs';
import { compareRun, recordReference } from './reference.js';
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

/** @returns {Record<string, string>} SHA-256 of every file the scenes can load, by path. */
function assetHashes(dir = join(ROOT, 'public')) {
    return Object.fromEntries(readdirSync(dir).sort().flatMap((entry) => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) return Object.entries(assetHashes(full));
        const path = relative(ROOT, full).replaceAll('\\', '/');
        return [[path, createHash('sha256').update(readFileSync(full)).digest('hex')]];
    }));
}

/** What the result depends on besides the code: browser, GPU and driver, assets. */
async function conditions(browser) {
    const { gpu } = await browser.send('SystemInfo.getInfo');
    return { browser: browser.version.Browser, gpu: gpu.devices, assets: assetHashes() };
}

mkdirSync(values.output, { recursive: true });
const browser = await connect(values.cdp, { timeoutMs: 600000 });
const page = await browser.openPage(`${values.base}/test/motion-reference/page.html`);
try {
    if (!await page.waitFor('window.ready === true')) {
        throw new Error('The reference page did not initialise: open test/motion-reference/page.html in this ' +
            'Chrome and read its console -- usually there is no WebGPU adapter.');
    }
    const now = await conditions(browser);
    const play = async name => {
        const run = await page.evaluate(`playScenario(${JSON.stringify(name)})`);
        return { ...run, checkpoints: run.checkpoints.map(({ step, positions }) => ({ step, positions: decode(positions) })) };
    };

    if (values.record) {
        const repeats = Number(values.repeats);
        for (const name of names) {
            const runs = [];
            for (let r = 0; r < repeats; r++) runs.push(await play(name));
            const reference = recordReference(runs);
            const { scene, script } = SCENARIOS[name];
            writeFileSync(join(values.output, `${name}.json`), JSON.stringify({
                scenario: name, scene, script, batch: BATCH, dt: reference.dt,
                nodes: reference.checkpoints[0].positions.length / 3,
                checkpoints: reference.checkpoints.map(({ step, spread, tolerance, positions }) =>
                    ({ step, spread, tolerance, positions: encode(positions) }))
            }, null, 1) + '\n');
            console.log(`${name}: dt ${reference.dt} s, ${reference.checkpoints[0].positions.length / 3} nodes, ` +
                `spread ${reference.checkpoints.map(({ spread }) => spread).join(' / ')} m`);
        }
        writeFileSync(join(values.output, 'conditions.json'), JSON.stringify({
            commit: values.commit, recorded: new Date().toISOString(), repeats,
            tolerance: 'twice the furthest any repeat strayed from the first, per checkpoint', ...now
        }, null, 2) + '\n');
        console.log(`RECORDED ${names.join(', ')} into ${values.output}`);
    } else {
        const recorded = JSON.parse(readFileSync(join(RECORDED, 'conditions.json'), 'utf8'));
        const problems = Object.entries(recorded.assets)
            .filter(([path, hash]) => now.assets[path] !== hash)
            .map(([path, hash]) => `${path} is not the file the reference was recorded with (SHA-256 ${hash}); ` +
                'supply that file, the comparison means nothing on other input.');
        const report = {};
        for (const name of names) {
            const file = JSON.parse(readFileSync(join(RECORDED, `${name}.json`), 'utf8'));
            if (JSON.stringify(file.script) !== JSON.stringify(SCENARIOS[name].script) || file.batch !== BATCH) {
                problems.push(`${name}: scenarios.js no longer plays what was recorded; re-record on the old ` +
                    'implementation (README.md) in the change that edits the scenario.');
                continue;
            }
            const reference = { ...file, checkpoints: file.checkpoints.map(c => ({ ...c, positions: decode(c.positions) })) };
            const result = compareRun(reference, await play(name));
            report[name] = result.checkpoints;
            problems.push(...result.problems);
            console.log(`${name}: ${result.checkpoints.map(({ step, distance }) => `step ${step} ${distance} m`).join(', ')}`);
        }
        const elsewhere = now.browser !== recorded.browser ||
            JSON.stringify(now.gpu.map(({ driverVersion }) => driverVersion)) !==
            JSON.stringify(recorded.gpu.map(({ driverVersion }) => driverVersion));
        writeFileSync(join(values.output, 'comparison.json'), JSON.stringify({
            recorded: { commit: recorded.commit, browser: recorded.browser, gpu: recorded.gpu },
            now: { browser: now.browser, gpu: now.gpu }, scenarios: report, problems
        }, null, 2) + '\n');
        if (problems.length) {
            if (elsewhere) {
                problems.push(`This browser or GPU driver is not the one recorded (${recorded.browser}, commit ` +
                    `${recorded.commit}). A different shader compiler can move results by itself: re-record on ` +
                    'that commit with this browser first (README.md) to tell the two apart.');
            }
            console.error(`FAIL: the motion differs from the reference.\n\n${problems.join('\n\n')}`);
            process.exitCode = 1;
        } else {
            console.log(`PASS: ${names.join(', ')} reproduce the reference recorded on ${recorded.commit}`);
        }
    }
} finally {
    await page.close();
    browser.close();
}
