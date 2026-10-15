import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { EXEMPTIONS } from '../kernel-boundary/exemptions.js';
import { KERNEL, auditExemptions, kernelViolations } from '../kernel-boundary/rules.js';
import { sourcePath, sourceFiles, packagedSource } from '../sourceTree.js';

/**
 * The visionary-sim package depends on WebGPU and nothing else. Its source spans the kernel
 * workspace and mixed rest-geometry modules still in the application. S1 logical
 * identities keep the original ratchet intact across the workspace move. What already crosses it is listed in
 * `test/kernel-boundary/exemptions.js`; the rewrite empties that list.
 */
describe('the kernel boundary in this tree', () => {
    const START = new URL('../kernel-boundary/exemptionsAtStart.json', import.meta.url);

    it('names kernel paths that exist', () => {
        for (const path of KERNEL) {
            expect(() => statSync(sourcePath(path)), `KERNEL names src/${path}, which does not exist`).not.toThrow();
        }
    });

    it('has no violation that is not exempted, and no exemption that is not needed or new', () => {
        const files = sourceFiles().map(path => ({ path, text: readFileSync(sourcePath(path), 'utf8'), kernel: packagedSource(path) || undefined }));
        const start = JSON.parse(readFileSync(START, 'utf8')).map(([file, rule, name, count]) => ({ file, rule, name, count }));
        const problems = auditExemptions(kernelViolations(files), EXEMPTIONS, start);
        expect(problems, `\n${problems.join('\n\n')}\n`).toEqual([]);
    });

    it('keeps the list the boundary started with as it was drawn', () => {
        // The ratchet above is only as fixed as its starting point. That file
        // records 2026-10-14 and is never edited; shrink exemptions.js instead.
        const digest = createHash('sha256').update(readFileSync(START)).digest('hex');
        expect(digest, 'test/kernel-boundary/exemptionsAtStart.json was edited: restore it')
            .toBe('8bd2cbe442feb8f86adcf950ca762e153317590cc6e7436f503997449d82cc69');
    });
});

/** A kernel file as the rules see it: a path relative to `src` and its text. */
const file = (path, text) => ({ path, text });

describe('what the kernel boundary counts as a violation', () => {
    it('counts a package import, including one made only for a type', () => {
        const violations = kernelViolations([
            file('sim/state/particles.js', [
                "import { StorageBuffer } from 'playcanvas';",
                "/** @param {import('playcanvas').GraphicsDevice} device */"
            ].join('\n'))
        ]);
        expect(violations).toContainEqual({ file: 'sim/state/particles.js', rule: 'import', name: 'playcanvas', count: 2 });
    });

    it('does not read prose that happens to say "from" as an import', () => {
        const violations = kernelViolations([
            file('sim/grip.js', '/**\n * Separating "how big is the hand" from "how fine is the mesh" is the point.\n */')
        ]);
        expect(violations).toEqual([]);
    });

    it('counts a local import that leaves the kernel, and not one that stays inside it', () => {
        const violations = kernelViolations([
            file('assets/shapes.js', [
                "import { translateMesh } from './objLoader.js';",
                "import { patch } from './tessellate.js';"
            ].join('\n')),
            file('sim/discretize/lattice/sample.js', "import wgsl from './sample.wgsl?raw';\nimport { a } from '../../../deformation/bind.js';")
        ]);
        expect(violations).toEqual([{ file: 'assets/shapes.js', rule: 'import', name: 'assets/tessellate.js', count: 1 }]);
    });

    it('counts the renderer\'s API wherever code uses it, and I/O or the page as free names', () => {
        const violations = kernelViolations([
            file('sim/solver/stepper.js', [
                'compute.setParameter("dt", dt);',
                'device.computeDispatch(list);',
                'const response = await fetch(url);',
                'document.body.append(canvas);',
                'if (!navigator.gpu) return;'
            ].join('\n'))
        ]);
        expect(violations).toEqual(expect.arrayContaining([
            { file: 'sim/solver/stepper.js', rule: 'name', name: 'setParameter', count: 1 },
            { file: 'sim/solver/stepper.js', rule: 'name', name: 'computeDispatch', count: 1 },
            { file: 'sim/solver/stepper.js', rule: 'name', name: 'fetch', count: 1 },
            { file: 'sim/solver/stepper.js', rule: 'name', name: 'document', count: 1 },
            { file: 'sim/solver/stepper.js', rule: 'name', name: 'navigator', count: 1 }
        ]));
    });

    it('does not count prose, messages, or someone else\'s property of the same name', () => {
        const violations = kernelViolations([
            file('sim/solver/stepper.js', [
                '// Nothing here can fetch, and the window of stability is narrow.',
                '/* This document explains StorageBuffer history. */',
                'throw new Error(`failed to fetch ${url} into the window`);',
                "const label = 'document';",
                'const width = options.window + layout.document;'
            ].join('\n'))
        ]);
        expect(violations).toEqual([]);
    });

    it('counts the WGSL dialect only PlayCanvas can bind, and not explicit WGSL', () => {
        const violations = kernelViolations([
            file('sim/constraints/wgsl/contacts.wgsl', [
                '// uniform gridOrigin: vec3f; is how the engine wants it',
                'var<storage, read_write> surface: array<Surface>;',
                'var<storage, read_write> contactGrid: array<atomic<u32>>;',
                'uniform gridOrigin: vec3f;',
                'uniform bucketCount: u32;',
                'fn cell(p: vec3f) -> vec3i { return vec3i(floor(p - uniform.gridOrigin)); }'
            ].join('\n')),
            file('sim/solver/wgsl/predict.wgsl', [
                '@group(0) @binding(0) var<storage, read_write> nodePos: array<vec4f>;',
                '@group(0) @binding(1)',
                'var<storage, read> nodeParams: array<NodeParams>;',
                '@group(0) @binding(2) var<uniform> params: Params;',
                'fn f() -> f32 { return params.dt; }'
            ].join('\n'))
        ]);
        expect(violations).toEqual([
            { file: 'sim/constraints/wgsl/contacts.wgsl', rule: 'dialect', name: 'var<storage> without @binding', count: 2 },
            { file: 'sim/constraints/wgsl/contacts.wgsl', rule: 'dialect', name: 'uniform declaration', count: 2 },
            { file: 'sim/constraints/wgsl/contacts.wgsl', rule: 'dialect', name: 'uniform.<name> read', count: 1 }
        ]);
    });

    it('ignores files outside the kernel', () => {
        expect(kernelViolations([file('scene/app.js', "import { AppBase } from 'playcanvas';\nfetch(url);")])).toEqual([]);
    });
});

describe('the exemption list that only shrinks', () => {
    const exempt = { file: 'sim/state/particles.js', rule: 'import', name: 'playcanvas', count: 2 };

    it('passes violations that are exempted exactly', () => {
        expect(auditExemptions([{ ...exempt }], [exempt], [exempt])).toEqual([]);
    });

    it('rejects a new violation, saying how to fix it rather than how to exempt it', () => {
        const problems = auditExemptions([
            { file: 'sim/solver/stepper.js', rule: 'name', name: 'document', count: 1 },
            { ...exempt, count: 3 }
        ], [exempt], [exempt]);
        expect(problems).toHaveLength(2);
        expect(problems[0]).toMatch(/src\/sim\/solver\/stepper\.js/);
        expect(problems[0]).toMatch(/document/);
        expect(problems[0]).toMatch(/I\/O/);
        expect(problems[1]).toMatch(/src\/sim\/state\/particles\.js.*3.*2/);
        for (const problem of problems) {
            expect(problem).toMatch(/do not add .*exemption/i);
        }
    });

    it('rejects an exemption left behind by a fix, saying to shrink the list', () => {
        const dialect = { file: 'sim/state/state.wgsl', rule: 'dialect', name: 'uniform declaration', count: 3 };
        const problems = auditExemptions([{ ...exempt, count: 1 }], [exempt, dialect], [exempt, dialect]);
        expect(problems).toHaveLength(2);
        expect(problems[0]).toMatch(/src\/sim\/state\/particles\.js.*1x.*2x/);
        expect(problems[0]).toMatch(/lower .*count to 1/i);
        expect(problems[1]).toMatch(/src\/sim\/state\/state\.wgsl/);
        expect(problems[1]).toMatch(/delete/i);
        for (const problem of problems) {
            expect(problem).toMatch(/test\/kernel-boundary\/exemptions\.js/);
        }
    });

    it('rejects an exemption the list did not start with, even one that matches a violation', () => {
        const added = { file: 'sim/pick.js', rule: 'name', name: 'document', count: 1 };
        const problems = auditExemptions([{ ...exempt }, { ...added }], [exempt, added], [exempt]);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/src\/sim\/pick\.js/);
        expect(problems[0]).toMatch(/only shrinks/);
    });

    it('rejects raising an exemption above where it started', () => {
        const problems = auditExemptions([{ ...exempt, count: 3 }], [{ ...exempt, count: 3 }], [exempt]);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/3x.*2x|2x.*3x/);
        expect(problems[0]).toMatch(/only shrinks/);
    });
});
