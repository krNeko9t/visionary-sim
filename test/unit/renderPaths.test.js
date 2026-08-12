import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The claim M9 makes: mesh and splats are two representations standing side
 * by side, neither a stepping stone to the other. `architecture.test.js`
 * already checks this at the area level (`render` may reach only
 * `deformation`); this file checks it at the file level, because the area
 * rule would stay green even if `mesh.js` and `splats.js` quietly started
 * importing each other -- both are inside `render`, so that edge is legal by
 * area and would say nothing about whether the two paths still know nothing
 * of each other.
 *
 * @see architecture.test.js for the rest of the layering.
 */

const SRC = fileURLToPath(new URL('../../src', import.meta.url));
const RENDER = join(SRC, 'render');
const BODY_JS = join(SRC, 'body/softBody.js');
const MAIN_JS = join(SRC, 'main.js');
const APP_JS = join(SRC, 'scene/app.js');

/** Files that draw the mesh path, versus the files that draw the splat path. */
const MESH_PATH = ['mesh.js', 'normals.js'];
const SPLAT_PATH = ['splats.js', 'ellipsoid.js'];

/**
 * @param {string} file - Absolute path to a source file.
 * @returns {string[]} Local (`./` or `../`) import targets, resolved to
 *   absolute paths, with any `?raw` query stripped.
 */
function localImports(file) {
    const text = readFileSync(file, 'utf8');
    return [...text.matchAll(/from\s+'(\.[^']+)'/g)].map((match) => {
        const target = resolve(dirname(file), match[1].split('?')[0]);
        return target.endsWith('.js') || target.endsWith('.wgsl') ? target : `${target}.js`;
    });
}

describe('the two render paths stand side by side', () => {
    it('has a view for every render geometry kind the body layer declares, and no more', () => {
        // `RenderGeometry` is the second of the two typedefs in softBody.js; the
        // first, `RestGeometry`, has its own `kind`s that are none of this
        // file's business. Splitting on the typedef keyword and taking the last
        // chunk is what isolates the one this test cares about.
        const text = readFileSync(BODY_JS, 'utf8');
        const chunks = text.split('@typedef');
        const renderGeometry = chunks[chunks.length - 1];
        expect(renderGeometry, 'softBody.js has no RenderGeometry typedef to read kinds from')
            .toMatch('RenderGeometry');

        const declaredKinds = [...renderGeometry.matchAll(/kind:\s*'(\w+)'/g)].map(m => m[1]);
        expect(declaredKinds.length).toBeGreaterThan(0);

        const mainText = readFileSync(MAIN_JS, 'utf8');
        const viewsBlock = mainText.match(/const VIEWS = \{([\s\S]*?)\n\};/);
        expect(viewsBlock, 'main.js has no `const VIEWS = { ... }` table').not.toBeNull();
        const viewKinds = [...viewsBlock[1].matchAll(/^\s*(\w+):/gm)].map(m => m[1]);

        expect(new Set(viewKinds)).toEqual(new Set(declaredKinds));
    });

    it('keeps the mesh path and the splat path from importing each other', () => {
        const crossings = [];
        for (const file of MESH_PATH) {
            for (const target of localImports(join(RENDER, file))) {
                if (SPLAT_PATH.some(other => target === join(RENDER, other))) {
                    crossings.push(`${file} -> ${relative(RENDER, target)}`);
                }
            }
        }
        for (const file of SPLAT_PATH) {
            for (const target of localImports(join(RENDER, file))) {
                if (MESH_PATH.some(other => target === join(RENDER, other))) {
                    crossings.push(`${file} -> ${relative(RENDER, target)}`);
                }
            }
        }
        expect(crossings, `\n${crossings.join('\n')}\n`).toEqual([]);
    });

    it('has both paths reaching nothing but the deformation channel and their own files', () => {
        const leaks = [...MESH_PATH, ...SPLAT_PATH].flatMap((file) => {
            const absolute = join(RENDER, file);
            return localImports(absolute)
                .filter(target => !target.startsWith(RENDER) && !target.startsWith(join(SRC, 'deformation')))
                .map(target => `${file} -> ${relative(SRC, target)}`);
        });
        expect(leaks, `\n${leaks.join('\n')}\n`).toEqual([]);
    });

    it('pins WebGPU splats to the sorter that reads the deformed work buffer', () => {
        const text = readFileSync(APP_JS, 'utf8');
        expect(text).toContain('GSPLAT_RENDERER_RASTER_GPU_SORT');
        expect(text).toMatch(
            /app\.scene\.gsplat\.renderer\s*=\s*GSPLAT_RENDERER_RASTER_GPU_SORT/
        );
    });
});
