// Shared declarations for every simulation kernel. `sim/kernels.js` prepends
// the generated Kuhn constants and then this file to each kernel source, so
// there is exactly one definition of the data layout.

// Per-body parameters. Laid out to WGSL's std430-like rules: every vec3 aligns
// to 16 bytes and is followed by a scalar that fills the gap. Total 80 bytes.
// `sim/arena.js` writes this exact layout.
struct Body {
    origin: vec3f,
    h: f32,
    cellDims: vec3u,
    nodeOffset: u32,
    nodeDims: vec3u,
    nodeCount: u32,
    alphaDev: f32,
    alphaHyd: f32,
    gamma: f32,
    damping: f32,
    friction: f32,
    grabNode: i32,
    pad0: f32,
    pad1: f32,
}

// One arena for the whole scene rather than per-body buffers: it keeps the
// dispatch count independent of the body count, and lets a colour group span
// every body at once.
var<storage, read_write> nodePos: array<vec4f>;
var<storage, read_write> nodePrev: array<vec4f>;
var<storage, read_write> nodeVel: array<vec4f>;
var<storage, read> nodeInvMass: array<f32>;
var<storage, read> cells: array<vec2u>;
var<storage, read> bodies: array<Body>;

// Bodies own contiguous node ranges, and there are only a handful of them, so a
// linear scan is cheaper than storing a node-to-body index for every node.
fn bodyOfNode(node: u32) -> u32 {
    let count = arrayLength(&bodies);
    for (var b = 0u; b + 1u < count; b++) {
        if (node < bodies[b].nodeOffset + bodies[b].nodeCount) {
            return b;
        }
    }
    return count - 1u;
}

fn cellCoords(dims: vec3u, linear: u32) -> vec3u {
    return vec3u(
        linear % dims.x,
        (linear / dims.x) % dims.y,
        linear / (dims.x * dims.y)
    );
}

// Corner `c` of a cell sits at offset (c&1, (c>>1)&1, (c>>2)&1), matching
// CUBE_CORNERS in geometry/kuhn.js.
fn cornerNode(b: Body, coord: vec3u, corner: u32) -> u32 {
    let offset = vec3u(corner & 1u, (corner >> 1u) & 1u, (corner >> 2u) & 1u);
    let n = coord + offset;
    return b.nodeOffset + n.x + b.nodeDims.x * (n.y + b.nodeDims.y * n.z);
}

// XPBD position correction scale for one constraint.
//
// Lambda is deliberately not accumulated: with one projection per substep it
// starts at zero, so the `alpha * lambda` term of the full XPBD update is
// identically zero and the projection reduces to an exact elastic force step.
// That is the "small steps" regime, and it saves a per-constraint buffer.
// Running more than one iteration per substep would require storing lambda.
fn xpbdScale(
    c: f32, alphaTilde: f32,
    g0: vec3f, g1: vec3f, g2: vec3f, g3: vec3f,
    w0: f32, w1: f32, w2: f32, w3: f32
) -> f32 {
    let denom = w0 * dot(g0, g0) + w1 * dot(g1, g1) + w2 * dot(g2, g2) + w3 * dot(g3, g3) + alphaTilde;
    if (denom < 1e-20) {
        return 0.0;
    }
    return -c / denom;
}
