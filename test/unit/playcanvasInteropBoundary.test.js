import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';
import { ROOT } from '../sourceTree.js';

const INTEROP = 'apps/simulator/src/render/playcanvasInterop.js';
// Include browser fixtures: a test must not become another private-API adapter.
function scripts(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? scripts(path) : /\.(js|wgsl)$/.test(path) ? [path] : [];
    });
}

it('keeps PlayCanvas native-device and buffer internals in the interop module', () => {
    expect(existsSync(join(ROOT, INTEROP)), 'Create the application-owned PlayCanvas interop module').toBe(true);
    const violations = ['apps/simulator/src', 'apps/simulator/test', 'packages/visionary-sim/src']
        .flatMap(directory => scripts(join(ROOT, directory)))
        .filter(path => relative(ROOT, path).replaceAll('\\', '/') !== INTEROP)
        .filter(path => /\bwgpu\b|(?:\?\.|\.)\s*impl\b|\[\s*['"]impl['"]\s*\]|\bimpl\s*:|['"]impl['"]\s*:/.test(readFileSync(path, 'utf8')))
        .map(path => relative(ROOT, path));
    expect(violations, `Move private PlayCanvas access into ${INTEROP}`).toEqual([]);
});
