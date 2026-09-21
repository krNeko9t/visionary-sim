// What the contact constraint needs on top of the particle declarations: which
// nodes can touch something, the grid that finds them near each other, and
// where a substep's corrections are gathered before they are applied.
//
// `bodyContact.js` prepends `state.wgsl` and then this file to each of its
// four kernels. Nothing outside this constraint includes it, and it includes
// nothing of the elastic constraint's -- the two share the nodes and not one
// line more.
//
// Why a grid and not the parity trick next door: that trick works because two
// cells of one colour can never share a node, which holds across bodies only
// because each body owns a disjoint range of nodes. A contact is a pair of
// nodes from *different* bodies, so there is no parity to appeal to and no
// colouring to be had -- the pairs are not even known until the substep runs.
// This constraint is therefore Jacobi: every node gathers what the substep
// wants to do to it, and the average is applied afterwards.

// One record per node that can take part in a contact -- the boundary nodes,
// which are the only ones another body can reach.
//
// Identity, size and this substep's gathered correction sit in one struct
// rather than in three buffers on purpose. A kernel that includes the particle
// declarations has already spent five of the eight storage buffers WebGPU
// guarantees per stage, and this constraint needs two more; splitting these
// fields apart is what would not fit.
struct Surface {
    // Index into the shared node arrays, not into this body.
    node: u32,
    // Which body, so that a pair from one body can be dropped: a node's own
    // neighbours are the elastic constraint's business, not this one's.
    body: u32,
    radius: f32,
    pad0: u32,
    // xyz: corrections gathered this substep. w: how many were gathered.
    delta: vec4f,
}

var<storage, read_write> surface: array<Surface>;

// The broadphase, as one buffer: `bucketCount` occupancy counters, followed by
// `bucketCount * BUCKET_SLOTS` surface-record indices.
//
// Declared atomic throughout because the counters are: several nodes land in
// one bucket in the same dispatch. The slot entries are written and read
// through `atomicStore`/`atomicLoad`, which cost nothing over a plain access
// and keep the buffer one type.
var<storage, read_write> contactGrid: array<atomic<u32>>;

// How many nodes a bucket can hold. Mirrored in `bodyContact.js`, which sizes
// the buffer. `sort.wgsl` puts the live prefix in ascending surface-index order
// before any collision reads it, so equal positions produce equal neighbours
// regardless of GPU thread order.
//
// A bucket is one contact diameter across, so it can only be crowded where
// material is dense. Thirty-two covers both bodies' lattice corners in an
// ordinary overlap; past that fixed capacity the overflow is dropped, and
// the sort order makes what is dropped exactly the highest surface indices.
// This bounded local list avoids a prefix sum, global sort and variable
// allocation.
const BUCKET_SLOTS: u32 = 32u;

uniform gridOrigin: vec3f;
uniform gridDims: vec3u;
uniform gridCell: f32;
uniform bucketCount: u32;
uniform surfaceCount: u32;

// Which cell of the grid a world point falls in.
//
// Clamped rather than rejected, so a body dragged out of the tank still has
// somewhere to go. That cannot invent a contact -- the narrow phase measures
// the real distance either way -- it can only crowd the buckets at the rim,
// which costs contacts in exactly the situation where there are none.
fn gridCoord(p: vec3f) -> vec3u {
    let last = vec3f(uniform.gridDims) - vec3f(1.0);
    return vec3u(clamp(floor((p - uniform.gridOrigin) / uniform.gridCell), vec3f(0.0), last));
}

fn bucketAt(coord: vec3u) -> u32 {
    return coord.x + uniform.gridDims.x * (coord.y + uniform.gridDims.y * coord.z);
}
