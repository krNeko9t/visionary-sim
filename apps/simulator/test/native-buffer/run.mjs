import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { connect } from '../browser.mjs';

const { values } = parseArgs({ options: {
    base: { type: 'string' }, cdp: { type: 'string' }, output: { type: 'string' }
} });
if (!values.base || !values.cdp || !values.output) throw new Error('Required: --base, --cdp, --output');
mkdirSync(values.output, { recursive: true });
const browser = await connect(values.cdp);
const page = await browser.openPage(`${values.base}/test/native-buffer/page.html`);
try {
    assert(await page.waitFor('window.smoke?.done === true'), 'Native-buffer smoke did not finish within 30 seconds');
    const result = await page.evaluate('window.smoke');
    for (const phase of result.phases) {
        writeFileSync(join(values.output, `${phase.name}.png`), Buffer.from(phase.image.split(',')[1], 'base64'));
        delete phase.image;
    }
    writeFileSync(join(values.output, 'smoke.json'), JSON.stringify(result, null, 2) + '\n');
    assert.deepEqual(result.errors, [], 'PlayCanvas native-buffer smoke failed');
    assert.equal(result.phases.length, 6, 'All update, sort, detach and removal phases must run');
    console.log('PASS: native updates precede host evaluation; drawing and GPU sorting follow deformation; detach and release are clean');
} finally {
    await page.close();
    browser.close();
}
