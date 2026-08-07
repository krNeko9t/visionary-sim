import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The repository's shape, as a rule rather than as a promise.
 *
 * The file tree is how this project is meant to be understood without reading
 * the code, which only works if the tree tells the truth about what depends on
 * what. Directory names alone cannot enforce that -- one convenient import in a
 * hurry and the tidy tree is decoration over a tangle. So the layering is
 * written here and checked on every `npm test`.
 *
 * Read `ARCHITECTURE.md` for what each area is and why. This file only says
 * who may reach whom.
 */

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

/**
 * Which areas each area is allowed to import from. An entry permits that area
 * and anything nested inside it, so `sim` covers `sim/solver`; an area always
 * implicitly permits itself.
 *
 * Every rule here is a design decision, not housekeeping:
 *
 * - `render` may reach `deformation` and nothing else. This is the project's
 *   one structural commitment -- simulation geometry and render geometry are
 *   separate, and the deformation channel is the only thing that crosses. A
 *   render path that could import `sim` would learn what a cell is, and the
 *   separation would quietly stop being true.
 * - `deformation` may reach nothing. A channel that depended on either bank
 *   would no longer be a channel.
 * - `body` may reach only `assets`. A body describes an object; it must not
 *   learn how anyone chose to simulate it, or that choice becomes expensive to
 *   change.
 * - `sim/discretize` may not reach `sim/solver`. How an object is cut up must
 *   not depend on who solves it, so that either can be replaced alone.
 */
const ALLOWED = {
    'main.js': ['scene', 'sim', 'render'],
    scene: ['body', 'assets', 'sim'],
    sim: ['body', 'deformation', 'assets'],
    'sim/discretize': ['deformation', 'assets'],
    'sim/solver': ['sim/discretize', 'body', 'deformation'],
    'sim/debug': ['sim/discretize', 'deformation'],
    render: ['deformation'],
    body: ['assets'],
    assets: [],
    deformation: []
};

/** Areas that must exist. Deleting one is a design change, not a refactor. */
const REQUIRED = ['assets', 'body', 'deformation', 'sim', 'sim/discretize', 'sim/solver', 'scene'];

/**
 * @param {string} dir - Directory to walk.
 * @returns {string[]} Source paths relative to `src`, using forward slashes.
 */
function sourceFiles(dir = SRC) {
    return readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            return sourceFiles(full);
        }
        return /\.(js|wgsl)$/.test(entry) ? [relative(SRC, full).replaceAll('\\', '/')] : [];
    });
}

/**
 * The area a file belongs to: the most specific key of {@link ALLOWED} that
 * contains it.
 *
 * @param {string} file - Path relative to `src`.
 * @returns {string} Area name.
 */
function areaOf(file) {
    const keys = Object.keys(ALLOWED)
        .filter(key => file === key || file.startsWith(`${key}/`))
        .sort((a, b) => b.length - a.length);
    return keys[0] ?? file.split('/')[0];
}

/**
 * @param {string} area - Importing area.
 * @param {string} target - Area being imported.
 * @returns {boolean} Whether the edge is permitted.
 */
function permits(area, target) {
    const allowed = [area, ...(ALLOWED[area] ?? [])];
    return allowed.some(entry => target === entry || target.startsWith(`${entry}/`));
}

/** Every local import in the tree, as `{ from, to }` paths relative to `src`. */
const EDGES = sourceFiles().flatMap((file) => {
    const text = readFileSync(join(SRC, file), 'utf8');
    return [...text.matchAll(/from\s+'(\.[^']+)'/g)].map((match) => {
        const target = resolve(dirname(join(SRC, file)), match[1].split('?')[0]);
        return { from: file, to: relative(SRC, target).replaceAll('\\', '/') };
    });
});

describe('the layering the file tree claims', () => {
    it('has every area it is supposed to have', () => {
        for (const area of REQUIRED) {
            expect(() => statSync(join(SRC, area)), `src/${area} is missing`).not.toThrow();
        }
    });

    it('is a known area for every file', () => {
        const known = new Set(Object.keys(ALLOWED));
        for (const file of sourceFiles()) {
            const area = areaOf(file);
            expect(known.has(area), `src/${file} is in "${area}", which no rule covers`).toBe(true);
        }
    });

    it('has no import that the rules do not allow', () => {
        const violations = EDGES
            .filter(({ from, to }) => !permits(areaOf(from), areaOf(to)))
            .map(({ from, to }) => `${from}  ->  ${to}   (${areaOf(from)} may not reach ${areaOf(to)})`);

        expect(violations, `\n${violations.join('\n')}\n`).toEqual([]);
    });

    it('keeps the deformation channel free of both banks', () => {
        // Stated separately from the table because it is the one rule whose
        // breach would be invisible in behaviour: everything would still run,
        // and the separation would just no longer be real.
        const leaks = EDGES
            .filter(({ from, to }) => areaOf(from) === 'deformation' && areaOf(to) !== 'deformation')
            .map(({ from, to }) => `${from} -> ${to}`);

        expect(leaks).toEqual([]);
    });

    it('has no cycles', () => {
        const out = new Map();
        for (const { from, to } of EDGES) {
            out.set(from, [...(out.get(from) ?? []), `${to}${to.endsWith('.js') || to.endsWith('.wgsl') ? '' : '.js'}`]);
        }

        const state = new Map();
        /**
         * @param {string} node - File being visited.
         * @param {string[]} trail - Path taken to reach it.
         * @returns {string[]|null} The cycle, if one was found.
         */
        const visit = (node, trail) => {
            if (state.get(node) === 'done') {
                return null;
            }
            if (state.get(node) === 'open') {
                return [...trail, node];
            }
            state.set(node, 'open');
            for (const next of out.get(node) ?? []) {
                const cycle = visit(next, [...trail, node]);
                if (cycle) {
                    return cycle;
                }
            }
            state.set(node, 'done');
            return null;
        };

        for (const node of out.keys()) {
            const cycle = visit(node, []);
            expect(cycle, `cycle: ${cycle?.join(' -> ')}`).toBeNull();
        }
    });
});
