// Stable Neo-Hookean elasticity, XPBD form (Macklin & Muller 2021).
//
// One thread owns one lattice cell: it pulls the cell's eight nodes into
// registers, projects each of its six Kuhn tetrahedra in turn -- true
// Gauss-Seidel, each tetrahedron seeing the previous one's correction -- and
// writes the nodes back once.
//
// Within a tetrahedron the two constraints are *not* taken in turn. They are
// evaluated at the same deformation gradient and solved as one 2x2 block, which
// is what makes a compressible material hold its shape; see xpbdCouple in
// common.wgsl for why taking them in turn does not.
//
// Cells of one colour agree in index parity on every axis, so they never share
// a node (see cellColor in discretize/lattice.js). A whole colour therefore runs
// in parallel with no atomics and no read-modify-write races, and eight
// dispatches cover the scene. This is what makes Gauss-Seidel convergence
// available on a GPU at all; plain Jacobi would need far more iterations.

uniform colorStart: u32;
uniform colorCount: u32;
uniform dt: f32;

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let slot = gid.x;
    if (slot >= uniform.colorCount) {
        return;
    }

    let entry = cells[uniform.colorStart + slot];
    let b = bodies[entry.x];
    let coord = cellCoords(b.cellDims, entry.y);

    var p: array<vec3f, 8>;
    var w: array<f32, 8>;
    var ids: array<u32, 8>;
    for (var c = 0u; c < 8u; c++) {
        let n = cornerNode(b, coord, c);
        ids[c] = n;
        p[c] = nodePos[n].xyz;
        w[c] = nodeInvMass[n];
    }

    let invDt2 = 1.0 / (uniform.dt * uniform.dt);
    let alphaDev = b.alphaDev * invDt2;
    let alphaHyd = b.alphaHyd * invDt2;
    // Every rest cell is the same cube, so the six rest shape inverses are
    // scene-wide constants and only need scaling by the cell size. There is no
    // per-tetrahedron rest data in memory at all.
    let restScale = 1.0 / b.h;

    for (var t = 0u; t < 6u; t++) {
        let tet = KUHN_TETS[t];
        let i0 = tet.x;
        let i1 = tet.y;
        let i2 = tet.z;
        let i3 = tet.w;

        let w0 = w[i0];
        let w1 = w[i1];
        let w2 = w[i2];
        let w3 = w[i3];
        if (w0 + w1 + w2 + w3 == 0.0) {
            continue;
        }

        let B = KUHN_REST_INV[t] * restScale;
        let Bt = transpose(B);

        let base = p[i0];
        let F = mat3x3f(p[i1] - base, p[i2] - base, p[i3] - base) * B;

        // Deviatoric: C = ||F||_F, energy mu/2 * tr(F^T F).
        let cDev = sqrt(dot(F[0], F[0]) + dot(F[1], F[1]) + dot(F[2], F[2]));
        // Hydrostatic: C = det(F) - gamma. gamma = 1 + mu/lambda is exactly the
        // offset that makes F = I a stationary point of the combined energy, so
        // a body at rest neither collapses under the deviatoric term nor
        // inflates.
        let cHyd = determinant(F) - b.gamma;

        // dC/dp_{1,2,3} are the columns of (dC/dF) * B^T; the fourth gradient
        // follows from translation invariance.
        //
        // A near-collapsed tetrahedron has no deviatoric direction to speak of.
        // Zeroing that gradient rather than branching leaves the block reading
        // `dLambdaD = -cDev / alphaDev` (nothing) and `dLambdaH = -cHyd / a11`
        // -- the hydrostatic projection on its own -- so the degenerate case
        // needs no second code path. It is a guard against NaN, not a rescue:
        // at F = 0 exactly the cofactor matrix vanishes too, and the
        // tetrahedron is a fixed point either way.
        let mDev = (F * select(0.0, 1.0 / cDev, cDev > 1e-9)) * Bt;
        let mHyd = mat3x3f(cross(F[1], F[2]), cross(F[2], F[0]), cross(F[0], F[1])) * Bt;

        let d1 = mDev[0];
        let d2 = mDev[1];
        let d3 = mDev[2];
        let d0 = -(d1 + d2 + d3);

        let h1 = mHyd[0];
        let h2 = mHyd[1];
        let h3 = mHyd[2];
        let h0 = -(h1 + h2 + h3);

        let gram = vec3f(
            w0 * dot(d0, d0) + w1 * dot(d1, d1) + w2 * dot(d2, d2) + w3 * dot(d3, d3),
            w0 * dot(d0, h0) + w1 * dot(d1, h1) + w2 * dot(d2, h2) + w3 * dot(d3, h3),
            w0 * dot(h0, h0) + w1 * dot(h1, h1) + w2 * dot(h2, h2) + w3 * dot(h3, h3)
        );

        let dl = xpbdCouple(cDev, cHyd, alphaDev, alphaHyd, gram);
        p[i0] += (d0 * dl.x + h0 * dl.y) * w0;
        p[i1] += (d1 * dl.x + h1 * dl.y) * w1;
        p[i2] += (d2 * dl.x + h2 * dl.y) * w2;
        p[i3] += (d3 * dl.x + h3 * dl.y) * w3;
    }

    for (var c = 0u; c < 8u; c++) {
        nodePos[ids[c]] = vec4f(p[c], 0.0);
    }
}
