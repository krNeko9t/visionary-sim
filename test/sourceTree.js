import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The application's source root; every path the structural tests name is relative to it. */
export const SRC = fileURLToPath(new URL('../src', import.meta.url));

/**
 * @param {string} dir - Directory to walk.
 * @returns {string[]} Source paths relative to `src`, using forward slashes,
 *   with the offline tools as `../tools/...`.
 */
export function sourceFiles(dir = SRC) {
    const files = readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            return sourceFiles(full);
        }
        return /\.(js|wgsl|css)$/.test(entry) ? [relative(SRC, full).replaceAll('\\', '/')] : [];
    });
    return dir === SRC ? [...files, ...sourceFiles(join(SRC, '../tools'))] : files;
}
