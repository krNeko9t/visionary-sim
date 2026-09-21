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
 * - `sim/discretize` may reach `sim/state`, `sim/constraints` and `body`, and
 *   not `sim/solver`. A discretisation hands over its own elastic constraints,
 *   because what an element is and how elements are batched is knowledge of
 *   how the body was cut up (ADR-0007); building them takes the nodes, the
 *   solver's formulas -- XPBD compliance and the constitutive block -- and the
 *   material. It still cannot see the stepper that runs them (ADR-0013).
 * - `sim/discretize/lattice` reaches what `sim/discretize` does, plus the
 *   neutral side of `sim/discretize` itself. It is a row of its own because it
 *   is the one directory allowed to know the proxy is a lattice
 *   ({@link DISCRETISATION_RESIDENT}), so what it may reach is worth saying
 *   out loud rather than inheriting by prefix (ADR-0012).
 * - `sim/state` may reach nothing at all. It holds the degrees of freedom and
 *   must not know what any of them are for. This is the seam that lets a second
 *   kind of constraint exist: contact between bodies shares nothing with
 *   elasticity except the nodes it moves, so the nodes are what both are
 *   allowed to see, and neither can see the other.
 * - `sim/solver` may reach `sim/state` and nothing else -- in particular not
 *   `sim/constraints`. The stepper runs whatever constraint sets it is handed
 *   and must stay unable to name them; the moment it can, "add a constraint
 *   type" turns back into "edit the loop".
 * - `sim/constraints` may reach `sim/state` and `body`. A constraint is
 *   entitled to know the nodes it moves and what the thing is made of, but not
 *   how the body was cut up: contact reads a proxy's `contactSurface()` handed
 *   to it, and the elastic constraint lives on the discretisation's side, so
 *   nothing here needs to import `sim/discretize` -- and must not, or the edge
 *   would run both ways (ADR-0013). It may not reach `sim/solver`: constraints
 *   are run, they do not run anything.
 * - `ui` may reach `sim` and `body` and nothing else. It edits materials and
 *   drives the simulation, and it does both through the surfaces those two
 *   already publish. Letting it reach a lattice or a buffer would put a second
 *   opinion about the simulation's state in the interface.
 */
const ALLOWED = {
    '../tools': ['assets', 'scene', 'body', 'sim'], // Exact entry points below; ADR-0017/0018.
    'main.js': ['scene', 'sim', 'render', 'ui'],
    ui: ['sim', 'body'],
    scene: ['body', 'assets', 'sim'],
    sim: ['body', 'deformation', 'assets'],
    'sim/discretize': ['deformation', 'assets', 'sim/state', 'sim/constraints', 'body'],
    'sim/discretize/lattice': ['sim/discretize', 'deformation', 'assets', 'sim/state', 'sim/constraints', 'body'],
    'sim/state': [],
    'sim/constraints': ['sim/state', 'body'],
    'sim/solver': ['sim/state'],
    render: ['deformation'],
    body: ['assets'],
    assets: [],
    deformation: []
};

/** Areas that must exist. Deleting one is a design change, not a refactor. */
const REQUIRED = [
    '../tools', 'assets', 'body', 'deformation', 'render', 'sim', 'sim/discretize', 'sim/discretize/lattice',
    'sim/state', 'sim/constraints', 'sim/solver', 'scene', 'ui'
];

/**
 * Names that belong to whoever is doing the rendering.
 *
 * The table above is a table of *imports*, and a module can know something
 * without importing it: calling a method on an object it did not make, or
 * naming a foreign type in an annotation, are both dependencies that no import
 * check will ever see. Wherever the tree makes a claim, this list is how that
 * claim is kept true rather than merely displayed.
 *
 * Matched case-sensitively, and that is load-bearing rather than sloppy:
 * `playcanvas` in lower case is how the package is named in an import or a type
 * annotation, while prose that discusses the engine writes PlayCanvas. The
 * first is a dependency and the second is a sentence.
 */
const RENDERER_API = ['playcanvas', 'setParameter', 'getShaderChunks', 'StorageBuffer'];

/**
 * How the proxy geometry happens to be cut up today. A word list rather than an
 * import rule, for the same reason {@link RENDERER_API} is one: a render path
 * that started reasoning about cells would not import anything to do it -- it
 * would just read `field.h` off a field it was handed, and every import check
 * would go on passing.
 *
 * `node` is not on the list. It is a word this engine also uses for a scene
 * graph entity, so it cannot separate the two banks; `nodeDims` and `nodeOffset`
 * are the parts that would actually leak, and they are caught by prefix.
 */
const DISCRETISATION = [
    // On a word boundary, or "cell" red-lights the suite over the word
    // "excellent" in a comment.
    /\blattice/i, /\bvoxel/i, /\bcell/i, /\btetra/i,
    // Every parameter the lattice sampler declares is `deform` then a capital,
    // which catches the whole bag at once. Case-sensitive on purpose: a render
    // path is entitled to say "deformation".
    /\bdeform[A-Z]/
];

/**
 * The one directory that may speak {@link DISCRETISATION}: it holds the
 * lattice, so it is the only place that has to know one exists. Everything
 * else sees a body's discretisation as a `ProxyGeometry`
 * (`sim/discretize/proxyGeometry.js`).
 */
const DISCRETISATION_RESIDENT = 'sim/discretize/lattice';

/**
 * @param {string} file - Path relative to `src`.
 * @returns {RegExp[]} The {@link DISCRETISATION} patterns `file` matches.
 */
function discretisationIn(file) {
    // Import specifiers are blanked out: a path into the resident says where a
    // module lives, not what it is, and who may reach the resident at all is
    // an import rule -- {@link DISCRETISATION_RESIDENT}'s own test below.
    const text = readFileSync(join(SRC, file), 'utf8').replace(/from\s+'[^']*'/g, "from ''");
    return DISCRETISATION
        // `deform` then a capital is how every piece of shader text pasted into
        // someone else's shader names what it introduces -- the channel's own
        // (`covariance.wgsl`) and a sampler's parameters alike -- so inside
        // `deformation/` the pattern would catch the channel for existing.
        // Outside it and the resident, the same name means someone is reading
        // a sampler's parameters, which is the leak it was written for.
        .filter(pattern => !(areaOf(file) === 'deformation' && pattern.source === '\\bdeform[A-Z]'))
        .filter(pattern => pattern.test(text));
}

/**
 * Words that belong to whoever is reaching into the scene from outside it.
 *
 * `sim/state` holds the degrees of freedom and must not know what any of them
 * are for; `sim/solver` runs whatever constraints it is handed and must stay
 * unable to name them. A prescribed node -- one a constraint has told rather
 * than solved for -- used to be exactly the leak this catches: a `grabNode`
 * field in the shared node state, a `grabTarget` uniform the stepper carried
 * and branched on. Both are gone, and this is what keeps them from coming
 * back by the same route: `sim/state` now offers only the neutral
 * `setPrescribed`/`clearPrescribed`, which say nothing about who is asking or
 * why.
 *
 * `handle` is deliberately not on this list: the grab chain no longer says it,
 * and `sim/solver/stepper.js` uses the word for something else ("handles the
 * read-after-write hazards").
 */
const INTERACTION = [/\bgrab/i, /\bpointer/i, /\bdrag/i, /\bgrip/i];

/**
 * @param {string} dir - Directory to walk.
 * @returns {string[]} Source paths relative to `src`, using forward slashes.
 */
function sourceFiles(dir = SRC) {
    const files = readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            return sourceFiles(full);
        }
        return /\.(js|wgsl|css)$/.test(entry) ? [relative(SRC, full).replaceAll('\\', '/')] : [];
    });
    return dir === SRC ? [...files, ...sourceFiles(join(SRC, '../tools'))] : files;
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
    const text = readFileSync(join(SRC, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    return [...text.matchAll(/(?:from\s+|import\s*\()'(\.[^']+)'/g)].map((match) => {
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

    it('keeps the deformation channel free of any renderer API', () => {
        // The import rules cannot see this one. `bind.js` used to take a
        // PlayCanvas material and call `setParameter` on it six times, and said
        // so in an `import('playcanvas').Material` annotation -- and every
        // import check passed the whole time, because the edge scan only
        // matches relative paths. The tree said the channel depended on
        // nothing, the suite certified it, and it was not true. A guarantee
        // that is wrong is worse than one that was never offered, so the
        // knowledge edges are checked by name as well.
        //
        // The scope is stated rather than overclaimed: the lattice's sampler
        // (`sim/discretize/lattice/sample.wgsl`, outside this rule since it
        // left the channel) still writes PlayCanvas's WGSL dialect --
        // `uniform x: T;` read back as `uniform.x`, storage bindings left for
        // the engine to assign. That coupling is real, this rule does not reach
        // it, and it goes when the GPU resource seam does.
        const leaks = sourceFiles()
            .filter(file => areaOf(file) === 'deformation')
            .flatMap((file) => {
                const text = readFileSync(join(SRC, file), 'utf8');
                return RENDERER_API
                    .filter(name => text.includes(name))
                    .map(name => `src/${file} mentions "${name}"`);
            });

        expect(leaks, `\n${leaks.join('\n')}\n`).toEqual([]);
    });

    it('keeps the render paths free of any discretisation', () => {
        // The mirror of the rule above, and the one that decides whether the
        // proxy geometry can actually be replaced. A field is handed over as
        // shader text plus a bag of parameters precisely so that nothing here
        // can read a cell size out of it; this checks that nothing tried.
        const leaks = sourceFiles()
            .filter(file => areaOf(file) === 'render')
            .flatMap((file) => {
                const text = readFileSync(join(SRC, file), 'utf8');
                return DISCRETISATION
                    .filter(pattern => pattern.test(text))
                    .map(pattern => `src/${file} matches ${pattern}`);
            });

        expect(leaks, `\n${leaks.join('\n')}\n`).toEqual([]);
    });

    it('lets only the lattice\'s own directory know it is a lattice', () => {
        // The render rule above, extended to everything. What it buys is
        // locality, not a second backend: "replacing the lattice touches one
        // directory" becomes a sentence the suite can check rather than one
        // somebody has to remember to correct.
        //
        // `sim/state/` gets no exemption even though it used to announce, in
        // so many words, that it had never heard of a lattice. A file that
        // does not know something can say so without naming it.
        const leaks = sourceFiles()
            .filter(file => !file.startsWith(`${DISCRETISATION_RESIDENT}/`))
            .flatMap(file => discretisationIn(file).map(pattern => `src/${file} matches ${pattern}`));

        expect(leaks, `\n${leaks.join('\n')}\n`).toEqual([]);
    });

    it('lets only the discretisation\'s dispatch reach into the lattice', () => {
        // The half of the rule above that the word list hands over. A module
        // that imports from the resident knows the lattice exists whatever it
        // names the binding, so the edge is checked here, by import, and the
        // word list is left to catch what no import shows. `sim/discretize/`
        // is the one place that chooses which proxy geometry a body gets, so
        // it is the one place that has to know where each kind lives (ADR-0014).
        const leaks = EDGES
            .filter(({ to }) => areaOf(to) === DISCRETISATION_RESIDENT)
            .filter(({ from }) => areaOf(from) !== DISCRETISATION_RESIDENT && areaOf(from) !== 'sim/discretize')
            .map(({ from, to }) => `${from} -> ${to}`);

        expect(leaks, `\n${leaks.join('\n')}\n`).toEqual([]);
    });

    it('keeps the degrees of freedom and the stepper free of interaction', () => {
        // The mirror of the discretisation rule above, guarding the other
        // structural commitment: `sim/state` does not know what a degree of
        // freedom is for, and `sim/solver` cannot name a constraint. Both
        // guarantees are import-invisible in the same way -- a privileged
        // channel reads and writes ordinary fields, it does not import
        // anything to do it -- so this checks by name instead.
        const leaks = sourceFiles()
            .filter(file => areaOf(file) === 'sim/state' || areaOf(file) === 'sim/solver')
            .flatMap((file) => {
                const text = readFileSync(join(SRC, file), 'utf8');
                return INTERACTION
                    .filter(pattern => pattern.test(text))
                    .map(pattern => `src/${file} matches ${pattern}`);
            });

        expect(leaks, `\n${leaks.join('\n')}\n`).toEqual([]);
    });

    it('keeps offline tools out of runtime and limits their shared scene dependency', () => {
        expect(EDGES.filter(({ from, to }) => !from.startsWith('../tools/') && to.startsWith('../tools/'))).toEqual([]);
        const shared = new Set(['scene/metricRegion.js', 'scene/alocasiaData.js', 'body/softBody.js',
            'sim/discretize/discretize.js', 'sim/staticPrescription.js', 'sim/state/materialCounts.js']);
        expect(EDGES.filter(({ from, to }) => from.startsWith('../tools/') &&
            !to.startsWith('../tools/') && !to.startsWith('assets/') && !shared.has(to))).toEqual([]);
        for (const file of sourceFiles().filter(file => !file.startsWith('../tools/'))) {
            expect(readFileSync(join(SRC, file), 'utf8')).not.toMatch(/(?:from\s*|import\s*\()(['"])node:/);
        }
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
