/**
 * What kernel source already does across the boundary in `rules.js`, as of the
 * day the boundary was drawn. These are debts, not permissions.
 *
 * The list only shrinks. `test/unit/kernelBoundary.test.js` fails on anything
 * not listed here, on a count above the one listed, and on a row whose
 * violation has gone or shrunk -- delete or lower the row in the same change
 * that fixes the code. Rewriting the simulation onto WebGPU alone (stage S2 of
 * the first integration) empties it.
 *
 * Each row is `[file relative to src, rule, name, count]`; `rule` and `name`
 * mean what they mean in `rules.js`.
 */
const ROWS = [
    // Buffers and dispatch borrowed from PlayCanvas. They go when the kernel
    // gets its own thin compute backend over the GPUDevice.
    ['sim/simulator.js', 'import', 'playcanvas', 1],
    ['sim/simulator.js', 'name', 'computeDispatch', 1],
    ['sim/simulator.js', 'name', 'supportsCompute', 1],
    ['sim/state/particles.js', 'import', 'playcanvas', 2],
    ['sim/state/particles.js', 'name', 'StorageBuffer', 6],
    ['sim/solver/stepper.js', 'import', 'playcanvas', 3],
    ['sim/solver/stepper.js', 'name', 'setParameter', 7],
    ['sim/constraints/bodyContact.js', 'import', 'playcanvas', 2],
    ['sim/constraints/bodyContact.js', 'name', 'setParameter', 9],
    ['sim/constraints/bodyContact.js', 'name', 'StorageBuffer', 3],
    ['sim/constraints/kinematicDrive.js', 'import', 'playcanvas', 2],
    ['sim/constraints/kinematicDrive.js', 'name', 'setParameter', 11],
    ['sim/constraints/kinematicDrive.js', 'name', 'StorageBuffer', 2],
    ['sim/discretize/discretize.js', 'import', 'playcanvas', 1],
    ['sim/discretize/lattice/elasticCells.js', 'import', 'playcanvas', 3],
    ['sim/discretize/lattice/elasticCells.js', 'name', 'setParameter', 7],
    ['sim/discretize/lattice/elasticCells.js', 'name', 'StorageBuffer', 3],

    // The kernel's own shaders in PlayCanvas's WGSL dialect. They go when
    // every kernel declares explicit bindings.
    ['sim/state/state.wgsl', 'dialect', 'var<storage> without @binding', 5],
    ['sim/solver/wgsl/predict.wgsl', 'dialect', 'uniform declaration', 3],
    ['sim/solver/wgsl/predict.wgsl', 'dialect', 'uniform.<name> read', 4],
    ['sim/solver/wgsl/finalize.wgsl', 'dialect', 'uniform declaration', 4],
    ['sim/solver/wgsl/finalize.wgsl', 'dialect', 'uniform.<name> read', 8],
    ['sim/constraints/wgsl/contacts.wgsl', 'dialect', 'var<storage> without @binding', 2],
    ['sim/constraints/wgsl/contacts.wgsl', 'dialect', 'uniform declaration', 5],
    ['sim/constraints/wgsl/contacts.wgsl', 'dialect', 'uniform.<name> read', 5],
    ['sim/constraints/wgsl/bin.wgsl', 'dialect', 'uniform.<name> read', 2],
    ['sim/constraints/wgsl/sort.wgsl', 'dialect', 'uniform.<name> read', 3],
    ['sim/constraints/wgsl/collide.wgsl', 'dialect', 'uniform.<name> read', 3],
    ['sim/constraints/wgsl/settle.wgsl', 'dialect', 'uniform declaration', 1],
    ['sim/constraints/wgsl/settle.wgsl', 'dialect', 'uniform.<name> read', 3],
    ['sim/constraints/wgsl/drive.wgsl', 'dialect', 'var<storage> without @binding', 1],
    ['sim/constraints/wgsl/drive.wgsl', 'dialect', 'uniform declaration', 5],
    ['sim/constraints/wgsl/driveHard.wgsl', 'dialect', 'uniform.<name> read', 5],
    ['sim/constraints/wgsl/driveCompliant.wgsl', 'dialect', 'uniform.<name> read', 6],
    ['sim/discretize/lattice/wgsl/cells.wgsl', 'dialect', 'var<storage> without @binding', 2],
    ['sim/discretize/lattice/wgsl/project.wgsl', 'dialect', 'uniform declaration', 4],
    ['sim/discretize/lattice/wgsl/project.wgsl', 'dialect', 'uniform.<name> read', 7],

    // The deformation field handed to the host's shader, in the dialect. It
    // goes when a field becomes shader code plus a buffer manifest and each
    // host binding writes its own declarations.
    ['sim/discretize/lattice/sample.wgsl', 'dialect', 'var<storage> without @binding', 1],
    ['sim/discretize/lattice/sample.wgsl', 'dialect', 'uniform declaration', 5],
    ['sim/discretize/lattice/sample.wgsl', 'dialect', 'uniform.<name> read', 5],

    // Rest-geometry files that also hold the application's loaders and shape
    // generators. They go when the package takes the data shapes and the
    // loading, decoding and tessellation stay with the application.
    ['assets/objLoader.js', 'name', 'fetch', 1],
    ['assets/shapes.js', 'import', 'assets/tessellate.js', 1],
    ['assets/splats/cloud.js', 'import', 'assets/splats/ply.js', 2],
    ['assets/splats/cloud.js', 'name', 'fetch', 1]
];

/** @type {import('./rules.js').Violation[]} */
export const EXEMPTIONS = ROWS.map(([file, rule, name, count]) => ({ file, rule, name, count }));

/**
 * The total count the list started with. Lowering a row needs no change here;
 * the check below it only stops the list from growing back.
 */
export const EXEMPTIONS_AT_START = 158;
