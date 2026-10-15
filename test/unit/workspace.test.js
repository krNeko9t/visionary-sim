import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const json = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));

it('runs the private simulator app against the workspace kernel source', () => {
    expect(json('package.json').workspaces).toEqual(['packages/*', 'apps/*']);
    expect(json('apps/simulator/package.json')).toMatchObject({
        name: 'simulator-app', private: true, dependencies: { 'visionary-sim': '*' }
    });
    expect(json('packages/visionary-sim/package.json')).toMatchObject({ name: 'visionary-sim', private: true });
    const entry = import.meta.resolve('visionary-sim/sim/simulator.js');
    expect(realpathSync(fileURLToPath(entry))).toBe(
        fileURLToPath(new URL('packages/visionary-sim/src/sim/simulator.js', root)));
});
