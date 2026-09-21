// What the elastic constraint needs on top of the particle declarations: which
// cells there are and what each one is made of. The 2x2 block that projects one
// tetrahedron is the constitutive model's, not the lattice's, and lives in
// `sim/constraints/wgsl/xpbdCouple.wgsl`.
//
// `elasticCells.js` prepends the generated Kuhn constants, then `state.wgsl`,
// then `xpbdCouple.wgsl`, then this file, to its projection kernel. Nothing
// outside this constraint includes it -- the stepper's own passes move nodes
// without ever learning that a cell exists.

// Per-body constants for this constraint. 64 bytes, written by
// `elasticCells.js` to this exact layout.
//
// The lattice's world origin is deliberately absent. It is what the render side
// needs in order to find the cell a rest point falls in; nothing in here has to
// locate anything, because a cell arrives already identified. It used to be
// uploaded anyway, every frame, unread.
struct CellParams {
    cellDims: vec3u,
    nodeOffset: u32,
    nodeDims: vec3u,
    pad0: u32,
    h: f32,
    alphaDev: f32,
    alphaHyd: f32,
    gamma: f32,
    relaxation: f32,
    pad1: f32,
    pad2: f32,
    pad3: f32,
}

var<storage, read> cellParams: array<CellParams>;

// One entry per occupied cell: (body index, linear cell index), grouped by
// colour across every body at once.
var<storage, read> cells: array<vec2u>;

fn cellCoords(dims: vec3u, linear: u32) -> vec3u {
    return vec3u(
        linear % dims.x,
        (linear / dims.x) % dims.y,
        linear / (dims.x * dims.y)
    );
}

// Corner `c` of a cell sits at offset (c&1, (c>>1)&1, (c>>2)&1), matching
// CUBE_CORNERS in sim/discretize/lattice/corners.js.
fn cornerNode(cp: CellParams, coord: vec3u, corner: u32) -> u32 {
    let offset = vec3u(corner & 1u, (corner >> 1u) & 1u, (corner >> 2u) & 1u);
    let n = coord + offset;
    return cp.nodeOffset + n.x + cp.nodeDims.x * (n.y + cp.nodeDims.y * n.z);
}
