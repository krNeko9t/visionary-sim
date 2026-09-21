// The lattice's deformation field on the GPU: the same maths as `sample.js`,
// which is the CPU reference the unit tests pin.
//
// This text is pasted into somebody else's shader -- a render material's, a
// debug view's -- so every name it introduces is prefixed `deform`.
// `VoxelLattice.field()` supplies the data behind these declarations and is the
// only thing that does. What a consumer may call is `deformationAt` and nothing
// else: that and the `Deformation` struct are the contract (`deformation/bind.js`);
// the rest of this file is the lattice's own.

// Deformed node positions for the whole scene. The solver writes them as vec4f
// because a storage buffer it writes wants 16-byte alignment; this body's nodes
// start at `deformNodeOffset`. That layout is the one thing the two banks agree
// on, and `sim/state/state.wgsl` declares the same array read-write.
var<storage, read> deformNodePos: array<vec4f>;

uniform deformOrigin: vec3f;
uniform deformH: f32;
uniform deformCellDims: vec3u;
uniform deformNodeDims: vec3u;
uniform deformNodeOffset: u32;

// Both answers from one sampling. The gradient is what lets the render side do
// more than move points -- a mesh turns it into a normal, a Gaussian into a
// rotated covariance -- and it costs nothing extra once the eight corners have
// been read.
struct Deformation {
    position: vec3f,
    gradient: mat3x3f,
}

// A node's deformed position by its index in the dense grid. Internal to this
// sampler, not part of the contract: reading a node by index presumes node
// indices form one dense range, which is the lattice's assumption to make and
// nobody else's (I5 in `proxyGeometry.js`).
fn deformedNode(node: u32) -> vec3f {
    return deformNodePos[uniform.deformNodeOffset + node].xyz;
}

fn deformationAt(rest: vec3f) -> Deformation {
    let cellDims = vec3f(uniform.deformCellDims);
    let nodeDims = uniform.deformNodeDims;
    let inv = 1.0 / uniform.deformH;

    // Points outside the lattice keep extrapolating rather than being snapped
    // to the boundary: distorting geometry is a better failure than collapsing
    // it onto the outermost cell.
    let grid = (rest - uniform.deformOrigin) * inv;
    let cell = clamp(floor(grid), vec3f(0.0), cellDims - 1.0);
    let local = grid - cell;
    let base = vec3u(cell);

    var position = vec3f(0.0);
    var col0 = vec3f(0.0);
    var col1 = vec3f(0.0);
    var col2 = vec3f(0.0);

    for (var c = 0u; c < 8u; c++) {
        // Corner c is (c & 1, (c >> 1) & 1, (c >> 2) & 1) -- the order
        // `corners.js` fixes and the lattice indexes its nodes by.
        let corner = vec3u(c & 1u, (c >> 1u) & 1u, (c >> 2u) & 1u);
        let far = corner == vec3u(1u);
        let f = select(1.0 - local, local, far);
        let dir = select(vec3f(-1.0), vec3f(1.0), far);

        let index = base + corner;
        let p = deformedNode(index.x + nodeDims.x * (index.y + nodeDims.y * index.z));

        position += p * (f.x * f.y * f.z);

        // grad N_c, one component per axis; the deformation gradient is
        // sum_c x_c (x) grad N_c, accumulated here column by column.
        let g = vec3f(dir.x * f.y * f.z, dir.y * f.x * f.z, dir.z * f.x * f.y) * inv;
        col0 += p * g.x;
        col1 += p * g.y;
        col2 += p * g.z;
    }

    return Deformation(position, mat3x3f(col0, col1, col2));
}
