import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The documentation's shape, as a rule rather than as a promise.
 *
 * Four files carry everything that is not code, and they are split by *reader
 * and tense* rather than by topic: what the repository is now, what to do while
 * working on it, what was decided and got it wrong, and what is in flight. That
 * split only holds while something enforces it. Left as an intention it lasted
 * exactly as long as it took to have something to say -- the milestone log grew
 * without an end condition, history got written into present-tense sentences
 * until the file contradicted itself, and the dependency table ended up with
 * three copies of which two were stale and nobody could tell.
 *
 * So the two failure modes that actually happened are checked here:
 *
 *   - `ARCHITECTURE.md` claiming a tree that is not the tree.
 *   - The always-loaded files growing without limit.
 *
 * @see architecture.test.js for who may import whom.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SRC = join(ROOT, 'src');

/**
 * How many lines each file loaded into every session may spend.
 *
 * A budget rather than a style rule. These two are read in full whether or not
 * the current task needs them, so a line that does not change what someone does
 * next is not free -- it is a tax on every session that follows. The numbers are
 * deliberately close to current length: hitting the limit is the intended
 * prompt to move something to `docs/adr/`, to `ARCHITECTURE.md`, or to the
 * comment on the code it constrains, and raising it is a decision to be argued
 * for rather than a chore.
 */
const BUDGET = { 'CLAUDE.md': 50, 'STATUS.md': 32 };

/** Directories that are shader text belonging to their parent, not an area. */
const NOT_AN_AREA = 'wgsl';

/**
 * @param {string} dir - Directory to walk.
 * @returns {string[]} Directory paths relative to `src`, using forward slashes.
 */
function directories(dir = SRC) {
    return readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        if (!statSync(full).isDirectory()) {
            return [];
        }
        const here = relative(SRC, full).replaceAll('\\', '/');
        const nested = directories(full);
        return entry === NOT_AN_AREA ? [] : [here, ...nested];
    });
}

/**
 * The directories the architecture document says exist, read out of the table
 * in its "目录" section.
 *
 * Only the first column of each row is read, and only entries written as a path
 * ending in a slash -- so a directory mentioned in a prose cell does not count
 * as documenting it.
 *
 * @returns {string[]} Directory paths relative to `src`.
 */
function documentedDirectories() {
    const text = readFileSync(join(ROOT, 'ARCHITECTURE.md'), 'utf8');
    const section = text.split(/^## /m).find(part => part.startsWith('二、'));
    expect(section, 'ARCHITECTURE.md has no "二、目录" section').toBeTruthy();

    return [...section.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)]
        .map(match => match[1])
        .filter(entry => entry.endsWith('/'))
        .map(entry => entry.slice(0, -1));
}

describe('the documentation the repository ships', () => {
    it('describes every directory that exists', () => {
        const documented = new Set(documentedDirectories());
        const missing = directories().filter(dir => !documented.has(dir));

        expect(missing, `\nnot in ARCHITECTURE.md §二: ${missing.join(', ')}\n`).toEqual([]);
    });

    it('describes no directory that does not exist', () => {
        const actual = new Set(directories());
        const invented = documentedDirectories().filter(dir => !actual.has(dir));

        expect(invented, `\nARCHITECTURE.md §二 lists missing: ${invented.join(', ')}\n`).toEqual([]);
    });

    it('keeps the always-loaded files within budget', () => {
        const over = Object.entries(BUDGET)
            .map(([file, limit]) => ({
                file,
                limit,
                lines: readFileSync(join(ROOT, file), 'utf8').trimEnd().split('\n').length
            }))
            .filter(({ lines, limit }) => lines > limit)
            .map(({ file, lines, limit }) => `${file}: ${lines} lines, budget ${limit}`);

        expect(over, `\n${over.join('\n')}\n`).toEqual([]);
    });
});
