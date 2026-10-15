/**
 * What kernel source still does across the boundary in `rules.js`. These are
 * debts, not permissions.
 *
 * The list only shrinks. `test/unit/kernelBoundary.test.js` fails on anything
 * not listed here, on a count above the one listed, and on a row whose
 * violation has gone or shrunk -- delete or lower the row in the same change
 * that fixes the code. It also fails on a row that is new or higher than in
 * `exemptionsAtStart.json`, the list as it was the day the boundary was drawn,
 * which is never edited. Rewriting the simulation onto WebGPU alone empties it.
 *
 * Each row is `[file relative to src, rule, name, count]`; `rule` and `name`
 * mean what they mean in `rules.js`.
 */
const ROWS = [
    // The deformation field handed to the host's shader, in the dialect. It
    // goes when a field becomes shader code plus a buffer manifest and each
    // host binding writes its own declarations.
    ['sim/discretize/lattice/sample.wgsl', 'dialect', 'var<storage> without @binding', 1],
    ['sim/discretize/lattice/sample.wgsl', 'dialect', 'uniform declaration', 5],
    ['sim/discretize/lattice/sample.wgsl', 'dialect', 'uniform.<name> read', 5]

];

/** @type {import('./rules.js').Violation[]} */
export const EXEMPTIONS = ROWS.map(([file, rule, name, count]) => ({ file, rule, name, count }));
