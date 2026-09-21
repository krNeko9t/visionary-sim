// The degrees of freedom themselves, as every kernel sees them.
//
// Prepended to each compute kernel by whoever compiles it -- the stepper for
// its own passes, each constraint set for its projection -- so there is exactly
// one declaration of the particle layout however many readers there are.
//
// Nothing about how the nodes were laid out or batched appears in this file,
// and that is its whole job. A constraint that has never heard of the layout
// still moves the same nodes through the same buffers, which is what lets a
// second kind of constraint exist at all.

// vec4f rather than vec3f: a storage buffer a compute shader writes wants
// 16-byte alignment. The w component is unused. Every deformation field a
// discretisation hands out (`field()` in `sim/discretize/proxyGeometry.js`)
// reads the same array read-only and depends on this layout.
var<storage, read_write> nodePos: array<vec4f>;
var<storage, read_write> nodePrev: array<vec4f>;
var<storage, read_write> nodeVel: array<vec4f>;
var<storage, read> nodeInvMass: array<f32>;

// Per-body parameters that belong to the nodes rather than to any constraint:
// what slows them down, what they rub against. 32 bytes, written by
// `particles.js` to this exact layout.
struct NodeParams {
    nodeOffset: u32,
    nodeCount: u32,
    damping: f32,
    friction: f32,
    pad0: u32,
    pad1: u32,
    pad2: u32,
    pad3: u32,
}

var<storage, read> nodeParams: array<NodeParams>;

// Bodies own contiguous node ranges, and there are only a handful of them, so a
// linear scan is cheaper than storing a node-to-body index for every node.
fn bodyOfNode(node: u32) -> u32 {
    let count = arrayLength(&nodeParams);
    for (var b = 0u; b + 1u < count; b++) {
        if (node < nodeParams[b].nodeOffset + nodeParams[b].nodeCount) {
            return b;
        }
    }
    return count - 1u;
}
