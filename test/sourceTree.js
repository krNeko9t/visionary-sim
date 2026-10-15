import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const APP = join(ROOT, 'apps/simulator');
export const PACKAGE = join(ROOT, 'packages/visionary-sim');

/** Logical S1 source identities stay stable across the mechanical move.
 * Both physical trees are walked, so new package files are audited too.
 */
const locations = new Map();
const directories = new Set();
function walk(dir, base, prefix = '') {
    if (!relative(base, dir).replaceAll('\\', '/').split('/').includes('wgsl')) directories.add(relative(ROOT, dir).replaceAll('\\', '/'));
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const logical = prefix + relative(base, full).replaceAll('\\', '/');
        if (locations.has(logical) && !statSync(full).isDirectory()) {
            throw new Error(`Duplicate source identity: ${logical}`);
        }
        locations.set(logical, full);
        if (statSync(full).isDirectory()) walk(full, base, prefix);
    }
}
walk(join(APP, 'src'), join(APP, 'src'));
walk(join(PACKAGE, 'src'), join(PACKAGE, 'src'));
locations.set('../tools', join(APP, 'tools'));
walk(join(APP, 'tools'), join(APP, 'tools'), '../tools/');

/** Physical path of an S1 source identity, including directories. */
export const sourcePath = path => locations.get(path);
/** Every source in both workspaces, plus the application's offline tools. */
export const sourceFiles = () => [...locations.keys()].filter(path => /\.(js|wgsl|css)$/.test(path));
/** Source directories, excluding shader-text directories. */
export const sourceDirectories = () => [...directories];
/** All package source, including future directories not yet named by S1. */
export const packagedSource = path => sourcePath(path)?.startsWith(join(PACKAGE, 'src') + sep);

/** Resolve both relative imports and temporary workspace subpaths to S1 identities. */
export function sourceImport(from, specifier) {
    const clean = specifier.split('?')[0];
    if (clean.startsWith('visionary-sim/')) return clean.slice('visionary-sim/'.length);
    if (!clean.startsWith('.')) return clean;
    // Synthetic boundary-rule fixtures also use the original relative paths.
    if (!sourcePath(from)) return join(dirname(from), clean).replaceAll('\\', '/');
    const target = resolve(dirname(sourcePath(from)), clean);
    for (const [base, prefix] of [[join(APP, 'src'), ''], [join(PACKAGE, 'src'), ''], [join(APP, 'tools'), '../tools/']]) {
        if (target.startsWith(base + sep)) return prefix + relative(base, target).replaceAll('\\', '/');
    }
    return target;
}
