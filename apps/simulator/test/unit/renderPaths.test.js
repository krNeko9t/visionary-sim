import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { sourcePath } from '../../../../test/sourceTree.js';

/**
 * What `render/` promises the rest of the program: hand it a piece of rest-space
 * geometry and a deformation field, and it draws the one carried by the other.
 * It dispatches on what the geometry is made of -- triangles, Gaussians, line
 * segments -- and never on where it came from, so a body's surface and the
 * proxy's own wireframe are drawn the same way.
 *
 * `architecture.test.js` checks who may import whom, including that `render/`
 * reaches nothing but the deformation channel; this file checks that
 * everything handed over actually has somewhere to go.
 */

const SRC = fileURLToPath(new URL('../../src', import.meta.url));
const DRAW_JS = join(SRC, 'render/draw.js');
const APP_JS = join(SRC, 'scene/app.js');

/**
 * Where each piece of geometry that gets handed to `render/` has its kinds
 * declared, and the typedef that declares them.
 */
const HANDED_OVER = [
    { file: 'body/factory.js', typedef: 'RenderGeometry' },
    { file: 'sim/discretize/proxyGeometry.js', typedef: 'Wireframe' }
];

/**
 * @param {string} file - Path relative to `src`.
 * @param {string} name - Typedef to read.
 * @returns {string[]} The `kind`s it declares, whether written as an object
 *   literal (`kind: 'x'`) or as a property (`@property {'x'} kind`).
 */
function declaredKinds(file, name) {
    const text = readFileSync(sourcePath(file), 'utf8');
    // A typedef's text is the chunk after `@typedef` that names it: the literal
    // form puts the name after the type, at the end of the comment; the
    // property form puts it first and lists the properties after.
    const names = part => new RegExp(`^\\s*\\{object\\}\\s+${name}\\b|\\b${name}\\s*$`)
        .test(part.split('*/')[0].replace(/[\s*]+$/, ''));
    const chunk = text.split('@typedef').find(names);
    expect(chunk, `${file} has no ${name} typedef to read kinds from`).toBeDefined();
    return [...chunk.matchAll(/kind:\s*'(\w+)'|\{'(\w+)'\}\s+kind\b/g)].map(m => m[1] ?? m[2]);
}

describe('everything handed to render/ gets drawn', () => {
    it('has a way to draw every primitive kind of geometry that gets handed over', () => {
        const handed = HANDED_OVER.flatMap(({ file, typedef }) => {
            const kinds = declaredKinds(file, typedef);
            expect(kinds.length, `${typedef} in ${file} declares no kind`).toBeGreaterThan(0);
            return kinds;
        });

        const drawText = readFileSync(DRAW_JS, 'utf8');
        const table = drawText.match(/const PAINTERS = \{([\s\S]*?)\n\};/);
        expect(table, 'render/draw.js has no `const PAINTERS = { ... }` table').not.toBeNull();
        const drawn = [...table[1].matchAll(/^\s*(\w+):/gm)].map(m => m[1]);

        expect(new Set(drawn)).toEqual(new Set(handed));
    });

    it('pins WebGPU splats to the sorter that reads the deformed work buffer', () => {
        const text = readFileSync(APP_JS, 'utf8');
        expect(text).toContain('GSPLAT_RENDERER_RASTER_GPU_SORT');
        expect(text).toMatch(
            /app\.scene\.gsplat\.renderer\s*=\s*GSPLAT_RENDERER_RASTER_GPU_SORT/
        );
    });
});
