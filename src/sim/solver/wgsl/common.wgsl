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
// CUBE_CORNERS in deformation/corners.js.
fn cornerNode(b: Body, coord: vec3u, corner: u32) -> u32 {
    let offset = vec3u(corner & 1u, (corner >> 1u) & 1u, (corner >> 2u) & 1u);
    let n = coord + offset;
    return b.nodeOffset + n.x + b.nodeDims.x * (n.y + b.nodeDims.y * n.z);
}

// XPBD multipliers for the two constraints of one tetrahedron, solved together
// as a 2x2 block.
//
// Lambda is deliberately not accumulated: with one projection per substep it
// starts at zero, so the `alpha * lambda` term of the full XPBD update is
// identically zero and the block reduces to `A dLambda = -C`. That is the
// "small steps" regime, and it saves a per-constraint buffer. Running more than
// one iteration per substep would require storing lambda.
//
// Solving the two together rather than one after the other is what lets the
// material be compressible. Projected in turn they are damped by different
// amounts -- at rest `grad C_H = sqrt(3) grad C_D`, so the two denominators
// differ -- and the corrections that ought to cancel at `F = I` instead leave a
// net shrink per pair, which compounds until the body is a point. Only a
// hydrostatic constraint stiff enough to lock the volume outright stopped it,
// which is why gamma had to stay near 1.
//
// Solved together they cancel at `F = I` exactly, for every gamma, dt, volume
// and mass. There the two gradients are parallel, so the block moves the nodes
// along that one direction by `dLambdaD + sqrt(3) dLambdaH`, which works out to
// `sqrt(3) (alphaDev * mu / lambda - alphaHyd) / det`, and `alphaDev * mu /
// lambda` *is* `alphaHyd`: both are `1 / (lambda * V)`. Rest is a fixed point of
// the solver rather than something a stiff constraint holds it near.
//
// `A` cannot be singular. Its off-diagonal is a Cauchy-Schwarz inner product of
// the two gradient sets, so `det >= alphaDev * alphaHyd > 0` however parallel
// they become; the epsilon below is against underflow, not against the maths.
//
// `gram` is `(sum w |grad C_D|^2, sum w grad C_D . grad C_H, sum w |grad C_H|^2)`
// -- what the constraints contribute to the block. The compliances are added
// here so that no caller has to remember them.
fn xpbdCouple(cDev: f32, cHyd: f32, alphaDev: f32, alphaHyd: f32, gram: vec3f) -> vec2f {
    let a00 = gram.x + alphaDev;
    let a01 = gram.y;
    let a11 = gram.z + alphaHyd;

    let det = a00 * a11 - a01 * a01;
    if (det < 1e-20) {
        return vec2f(0.0, 0.0);
    }
    return vec2f(a01 * cHyd - a11 * cDev, a01 * cDev - a00 * cHyd) / det;
}
