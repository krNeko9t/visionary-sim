import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('ships both module Workers with their imported dependency graphs bundled', async () => {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const result = await build({ root, logLevel: 'silent', build: { write: false } });
    const output = (Array.isArray(result) ? result : [result]).flatMap(bundle => bundle.output);
    for (const name of ['worker', 'simulationWorker']) {
        const worker = output.find(file => new RegExp(`(?:^|/)${name}-[^/]+\\.js$`).test(file.fileName));
        expect(worker, `${name} must be emitted as a standalone worker dependency graph`).toBeDefined();
        const code = worker.type === 'asset' ? String(worker.source) : worker.code;
        expect(code).not.toMatch(/(?:from\s*|import\s*)['"]\.\//);
        expect(code).toContain('postMessage');
    }
}, 15000);
