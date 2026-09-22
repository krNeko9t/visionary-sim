import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

// Run against an isolated Chrome --remote-debugging-port and a local Vite
// server. This runner owns only the tab it creates and always closes that tab.
const { values } = parseArgs({ options: {
    cdp: { type: 'string', default: 'http://127.0.0.1:9351' },
    base: { type: 'string', default: 'http://127.0.0.1:5188' },
    output: { type: 'string', default: '/tmp/alocasia-drag-results.json' }
} });
const version = await (await fetch(`${values.cdp}/json/version`)).json();
const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
const pending = new Map();
let serial = 0;
socket.onmessage = event => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (!entry) return;
    clearTimeout(entry.timeout);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
};
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++serial;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 120000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
});
const { targetId } = await send('Target.createTarget', { url: `${values.base}/test/alocasia-drag.html` });
try {
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const evaluate = async expression => {
        const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
        if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
    };
    let ready = false;
    for (let i = 0; i < 120 && !ready; i++) {
        ready = await evaluate('window.ready === true');
        if (!ready) await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert(ready, 'WebGPU test page did not initialise');
    const gpu = await send('SystemInfo.getInfo');
    const results = { browser: version.Browser, gpu: gpu.gpu.devices };
    for (const [name, options] of Object.entries({ before: { legacy: true }, after: {}, large: { delta: [0.1, 0, 0] }, sideways: { delta: [0, 0, -0.04] } })) {
        results[name] = await evaluate(`runDrag(${JSON.stringify(options)})`);
        const r = results[name];
        console.log(`${name}: petiole=${r.held.mm[2].toFixed(3)} mm, leaf=${r.held.mm[6].toFixed(3)} mm, p95 stretch=${r.held.stretch.p95.toFixed(3)}`);
    }
    writeFileSync(values.output, JSON.stringify(results, null, 2) + '\n');
    // Both gates rejected the shipped behaviour before any production edit.
    assert(results.before.held.mm[2] < 1, 'Legacy control no longer reproduces local-only motion');
    assert(results.before.held.stretch.p95 > 1.15, 'Legacy control no longer reproduces rubber-like stretching');
    for (const name of ['after', 'large', 'sideways']) {
        const r = results[name];
        assert(r.held.mm[2] > 3, `${name}: the petiole must visibly respond`);
        assert(r.held.mm[6] > 15, `${name}: do not pass by making the leaf ungrabbable`);
        assert(r.held.stretch.samples > 500, 'Measure the leaf surface, not just a selected point');
        assert(r.held.stretch.p95 < 1.12 && r.held.stretch.max < 1.25, `${name}: excessive local stretching`);
        const jump = Math.hypot(...r.held.xyz[6].map((v, i) => v - r.releaseStep.xyz[6][i]));
        assert(jump < 0.001, `${name}: release must not teleport the leaf`);
        assert(r.release100ms.mm[6] > 1, `${name}: release must retain visible motion`);
        assert(r.release2000ms.mm[6] < r.held.mm[6] * 0.65, `${name}: motion must decay`);
        for (const state of ['rest', 'held', 'releaseStep', 'release100ms', 'release500ms', 'release2000ms']) {
            assert.equal(r[state].bad, 0, `${name}/${state}: non-finite nodes`);
            assert.equal(r[state].staticMax, 0, `${name}/${state}: support moved`);
        }
    }
    console.log(`PASS: GPU drag, strain and release regression; evidence: ${values.output}`);
} finally {
    await send('Target.closeTarget', { targetId });
    socket.close();
}
