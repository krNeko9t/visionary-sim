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
const page = await browser.openPage(`${values.base}/test/native-compute/page.html`);
try {
    assert(await page.waitFor('window.computeGate?.done === true'), 'Native-compute gate did not finish within 30 seconds');
    const result = await page.evaluate('window.computeGate');
    writeFileSync(join(values.output, 'smoke.json'), JSON.stringify(result, null, 2) + '\n');
    assert.deepEqual(result.errors, [], 'Native-compute gate failed');
    assert.equal(result.phases.length, 4, 'All drive, elastic, contact and lifecycle phases must run');
    console.log('PASS: native kernels, standalone stepping/readback, both drive laws, contact, reset and borrowed-device lifetime');
} finally {
    await page.close();
    browser.close();
}
