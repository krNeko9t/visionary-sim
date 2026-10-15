import { sourceImport } from '../sourceTree.js';

/**
 * Where the visionary-sim package will be cut out of this repository, and what
 * may not cross that line.
 *
 * The package depends on WebGPU and nothing else: no renderer, no I/O, no page
 * (visionary-editor `docs/adr/0002-visionary-sim-depends-only-on-webgpu.md`).
 * S1 logical paths are resolved through sourceTree.js across both workspaces,
 * including all package source.
 */

/**
 * Kernel candidates, by their original S1 source identity. A
 * directory covers everything inside it.
 *
 * - `sim`: solving -- discretisation, degrees of freedom, constraints, solver,
 *   grip and picking. `sim/simulator.js` is its one public entry.
 * - `deformation`: the deformation contract hosts paste into their shaders.
 * - `body`: physical descriptions and prepared rest geometry, including the
 *   pure geometry functions the solver needs. Asset preparation stays in the app.
 *
 * The import rule keeps the list complete: a kernel file that imports, or
 * names the type of, a file not on it is a violation, so whatever the kernel
 * needs is either listed here and checked, or reported.
 */
export const KERNEL = [
    'sim',
    'deformation',
    'body/softBody.js',
    'body/material.js',
    'body/restGeometry.js'
];

/**
 * @param {string} path - Path relative to `src`.
 * @returns {boolean} Whether `path` is kernel source.
 */
function isKernel(path) {
    return KERNEL.some(entry => path === entry || path.startsWith(`${entry}/`));
}

/**
 * Names that belong to whoever is doing the rendering.
 *
 * An import table cannot see these: a module can know something without
 * importing it, by calling a method on an object it did not make --
 * `compute.setParameter(...)`, `device.computeDispatch(...)` -- so the names
 * are checked as well. `test/unit/architecture.test.js` holds `deformation/`
 * to the whole list, prose included; the kernel boundary below holds all
 * kernel code to it.
 *
 * Matched case-sensitively, and that is load-bearing rather than sloppy:
 * `playcanvas` in lower case is how the package is named in an import or a type
 * annotation, while prose that discusses the engine writes PlayCanvas. The
 * first is a dependency and the second is a sentence.
 */
export const RENDERER_API = [
    'playcanvas', 'setParameter', 'getShaderChunks', 'StorageBuffer', 'computeDispatch', 'supportsCompute', 'deviceType'
];

/**
 * Globals that mean I/O or a page. The kernel takes its data as arguments and
 * its `GPUDevice` from the host; loading files, creating a device and owning a
 * frame are the application's. Matched only as free names, so a field that
 * happens to be called `window` on some object of the kernel's own is not a
 * use of the browser's.
 */
const HOST_GLOBALS = [
    'fetch', 'XMLHttpRequest', 'WebSocket', 'document', 'window', 'navigator', 'localStorage', 'requestAnimationFrame'
];

/**
 * WGSL that only PlayCanvas can bind. Its shader preprocessor gathers every
 * `uniform x: T;` line into a block it packs itself and rewrites `uniform.x`
 * to read from it, and assigns bindings to `var<storage>` declarations that
 * have none. A kernel shader must be bindable by any WebGPU host, so it
 * declares its own `@group`/`@binding` and its own uniform struct.
 */
const DIALECT = [
    ['var<storage> without @binding', code => [...code.matchAll(/((?:@\w+\s*\([^)]*\)\s*)*)var<storage\b/g)]
        .filter(match => !match[1].includes('@binding')).length],
    ['uniform declaration', code => code.match(/^\s*uniform\s+\w+\s*:/gm)?.length ?? 0],
    ['uniform.<name> read', code => code.match(/(?<![\w$])uniform\.\w/g)?.length ?? 0]
];

/**
 * The text of a file with comments and the contents of string literals blanked
 * out, line structure kept. What is left is what the code does; what it says
 * about itself in prose or in a message is not a dependency.
 *
 * A JavaScript reader just good enough for this repository: it knows comments,
 * the three string quotes with `${}` nesting, and tells a regular expression
 * literal from a division by the character before it. WGSL has comments only.
 *
 * @param {string} path - File path; `.wgsl` is read as WGSL.
 * @param {string} text - Source text.
 * @returns {string} Code only.
 */
function codeOf(path, text) {
    const wgsl = path.endsWith('.wgsl');
    let out = '';
    let i = 0;
    /** Open template literals' `${` depths, innermost last. */
    const templates = [];
    let braces = 0;
    const blank = s => s.replace(/[^\n]/g, ' ');
    const regexMayStart = () => /(^|[=(,:;!&|?{}[+\-*%<>~^]|\breturn)\s*$/.test(out);
    while (i < text.length) {
        const two = text.slice(i, i + 2);
        const c = text[i];
        if (two === '//') {
            const end = text.indexOf('\n', i);
            const stop = end < 0 ? text.length : end;
            out += blank(text.slice(i, stop));
            i = stop;
        } else if (two === '/*') {
            const end = text.indexOf('*/', i + 2);
            const stop = end < 0 ? text.length : end + 2;
            out += blank(text.slice(i, stop));
            i = stop;
        } else if (wgsl) {
            out += c;
            i++;
        } else if (c === '\'' || c === '"') {
            let j = i + 1;
            while (j < text.length && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
            out += c + blank(text.slice(i + 1, j)) + c;
            i = j + 1;
        } else if (c === '`' || (c === '}' && templates.length && braces === templates.at(-1))) {
            if (c === '}') templates.pop();
            let j = i + 1;
            while (j < text.length && text[j] !== '`' && text.slice(j, j + 2) !== '${') j += text[j] === '\\' ? 2 : 1;
            out += c + blank(text.slice(i + 1, j));
            if (text.slice(j, j + 2) === '${') {
                templates.push(braces);
                out += '${';
                i = j + 2;
            } else {
                out += '`';
                i = j + 1;
            }
        } else if (c === '/' && regexMayStart()) {
            let j = i + 1;
            let inClass = false;
            while (j < text.length && text[j] !== '\n' && (inClass || text[j] !== '/')) {
                if (text[j] === '[') inClass = true;
                if (text[j] === ']') inClass = false;
                j += text[j] === '\\' ? 2 : 1;
            }
            out += '/' + blank(text.slice(i + 1, j)) + '/';
            i = j + 1;
        } else {
            if (c === '{') braces++;
            if (c === '}') braces--;
            out += c;
            i++;
        }
    }
    return out;
}

/**
 * @param {string} code - Code only, see {@link codeOf}.
 * @param {string} name - An identifier.
 * @param {boolean} free - Whether only a free name counts, not a property.
 * @returns {number} How many times `code` uses `name`.
 */
function uses(code, name, free) {
    const before = free ? '(?<![\\w$.])' : '(?<![\\w$])';
    return code.match(new RegExp(`${before}${name}(?![\\w$])`, 'g'))?.length ?? 0;
}

/**
 * Every import a file makes: static, dynamic, and JSDoc `import('...')` type
 * references. A type named in an annotation is a dependency the package would
 * have to carry, so annotations count.
 *
 * A `from '...'` only counts in code, where {@link codeOf} keeps it, so prose
 * that happens to say from "somewhere" is not read as one; `import('...')`
 * counts in code and in comments alike, because that is where a JSDoc type
 * annotation lives. The layering edges in `test/unit/architecture.test.js`
 * leave annotations out on purpose -- naming a type does not make one area
 * reach into another -- but a package has to ship every type it names.
 *
 * @param {string} text - Source text.
 * @param {string} code - The same text through {@link codeOf}, same length.
 * @returns {string[]} The specifiers, query strings removed.
 */
function importSpecifiers(text, code) {
    const statements = [...text.matchAll(/(?:\bfrom\s*|^\s*import\s+)(['"])([^'"]+)\1/gm)]
        .filter(match => code[match.index + match[0].length - 1] === match[1]);
    const calls = [...text.matchAll(/\bimport\s*\(\s*(['"])([^'"]+)\1/g)];
    return [...statements, ...calls].map(match => match[2].split('?')[0]);
}

/**
 * Where an import leads, named the way an exemption names it: a path relative
 * to `src` for a local file, the specifier itself for a package.
 *
 * @param {string} from - Importing file, relative to `src`.
 * @param {string} specifier - What it imports.
 * @returns {string} The target.
 */
function importTarget(from, specifier) {
    return sourceImport(from, specifier);
}

/**
 * @typedef {object} Violation
 * @property {string} file - Kernel file, relative to `src`.
 * @property {'import'|'name'|'dialect'} rule - Which rule it breaks.
 * @property {string} name - What it names: the import target, the identifier,
 *   or the kind of dialect.
 * @property {number} count - How many times this file does it.
 */

/**
 * What kernel source does that the package may not.
 *
 * @param {{ path: string, text: string, kernel?: boolean }[]} files - Source files, paths relative
 *   to `src`. Files outside the kernel are ignored.
 * @returns {Violation[]} One entry per file, rule and name.
 */
export function kernelViolations(files) {
    const counts = new Map();
    const add = (file, rule, name, n = 1) => {
        const key = keyOf({ file, rule, name });
        if (n > 0) counts.set(key, (counts.get(key) ?? 0) + n);
    };
    for (const { path, text } of files.filter(({ path, kernel }) => kernel || isKernel(path))) {
        const code = codeOf(path, text);
        for (const specifier of importSpecifiers(text, code)) {
            const target = importTarget(path, specifier);
            if (!isKernel(target)) {
                add(path, 'import', target);
            }
        }
        for (const [names, free] of [[RENDERER_API, false], [HOST_GLOBALS, true]]) {
            for (const name of names) {
                add(path, 'name', name, uses(code, name, free));
            }
        }
        if (path.endsWith('.wgsl')) {
            for (const [name, count] of DIALECT) {
                add(path, 'dialect', name, count(code));
            }
        }
    }
    return [...counts].map(([key, count]) => ({ ...JSON.parse(key), count }));
}

/** @param {Violation} violation - Any row. @returns {string} What identifies it, count aside. */
const keyOf = ({ file, rule, name }) => JSON.stringify({ file, rule, name });

/** Where the shrink-only list lives, for messages that tell someone to edit it. */
const EXEMPTIONS_FILE = 'test/kernel-boundary/exemptions.js';

/** For each rule: what a violation is, in a sentence fragment, and how to remove it. */
const RULES = {
    import: {
        what: name => `imports ${name}`,
        fix: name => (name.includes('/')
            ? `Kernel code imports only kernel files. If ${name} belongs in the package, add it to KERNEL in ` +
              'test/kernel-boundary/rules.js so it is checked too; if it is the application\'s (loading, ' +
              'placing, drawing), take what the kernel needs from it as an argument instead.'
            : `The package depends on WebGPU only: do with the GPUDevice the host hands over what ${name} does here.`)
    },
    name: {
        what: name => `uses ${name}`,
        fix: name => (RENDERER_API.includes(name)
            ? `${name} is the renderer's API: write this against the GPUDevice instead.`
            : `${name} is I/O or the page: the kernel takes its data as arguments and leaves loading, ` +
              'devices and frames to the application.')
    },
    dialect: {
        what: name => `has WGSL dialect: ${name}`,
        fix: () => 'Declare every binding with @group/@binding and the uniforms as a struct the kernel packs itself.'
    }
};

/**
 * Holds the tree to the exemption list, and the list to where it started.
 *
 * @param {Violation[]} violations - What the tree does today.
 * @param {Violation[]} exemptions - What it is allowed to do for now.
 * @param {Violation[]} start - The list as it was when the boundary was drawn.
 *   A row may only ever be lowered or deleted from there, so a fix never frees
 *   room for an exemption somewhere else.
 * @returns {string[]} Every disagreement, each saying what to do about it.
 */
export function auditExemptions(violations, exemptions, start) {
    const what = row => `src/${row.file} ${RULES[row.rule].what(row.name)}`;
    const fix = row => RULES[row.rule].fix(row.name);
    const allowed = new Map(exemptions.map(row => [keyOf(row), row.count]));
    const found = new Map(violations.map(row => [keyOf(row), row.count]));
    const started = new Map(start.map(row => [keyOf(row), row.count]));
    const problems = [];
    for (const violation of violations) {
        const limit = allowed.get(keyOf(violation));
        if (limit === undefined) {
            problems.push(`${what(violation)} (${violation.count}x). ${fix(violation)} ` +
                `Do not add an exemption: ${EXEMPTIONS_FILE} only shrinks.`);
        } else if (violation.count > limit) {
            problems.push(`${what(violation)} ${violation.count}x, but ${limit}x is exempted: this is new. ` +
                `${fix(violation)} Do not add to the exemption.`);
        }
    }
    for (const exemption of exemptions) {
        const count = found.get(keyOf(exemption)) ?? 0;
        const was = started.get(keyOf(exemption));
        if (was === undefined || exemption.count > was) {
            problems.push(`${what(exemption)}: ${EXEMPTIONS_FILE} exempts it ${exemption.count}x, but it started ` +
                `at ${was ?? 0}x and the list only shrinks. ${fix(exemption)}`);
        } else if (count === 0) {
            problems.push(`src/${exemption.file} no longer ${RULES[exemption.rule].what(exemption.name)}: ` +
                `delete its row from ${EXEMPTIONS_FILE}.`);
        } else if (count < exemption.count) {
            problems.push(`${what(exemption)} ${count}x, ${exemption.count}x is exempted: ` +
                `lower that row's count to ${count} in ${EXEMPTIONS_FILE}, so the list keeps saying what is left.`);
        }
    }
    return problems;
}
