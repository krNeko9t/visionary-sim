// Stable Neo-Hookean elasticity, XPBD form (Macklin & Muller 2021).
//
// One thread owns one lattice cell: it pulls the cell's eight nodes into
// registers, projects the two constraints of each of its six Kuhn tetrahedra
// *sequentially* -- true Gauss-Seidel, each projection seeing the previous
// one's correction -- and writes the nodes back once.
//
// Cells of one colour agree in index parity on every axis, so they never share
// a node (see cellColor in geometry/lattice.js). A whole colour therefore runs
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

        // Deviatoric: C = ||F||_F, energy mu/2 * tr(F^T F).
        {
            let base = p[i0];
            let F = mat3x3f(p[i1] - base, p[i2] - base, p[i3] - base) * B;
            let cd = sqrt(dot(F[0], F[0]) + dot(F[1], F[1]) + dot(F[2], F[2]));
            if (cd > 1e-9) {
                // dC/dp_{1,2,3} are the columns of (dC/dF) * B^T; the fourth
                // gradient follows from translation invariance.
                let g = (F * (1.0 / cd)) * Bt;
                let g1 = g[0];
                let g2 = g[1];
                let g3 = g[2];
                let g0 = -(g1 + g2 + g3);

                let s = xpbdScale(cd, alphaDev, g0, g1, g2, g3, w0, w1, w2, w3);
                p[i0] += g0 * (s * w0);
                p[i1] += g1 * (s * w1);
                p[i2] += g2 * (s * w2);
                p[i3] += g3 * (s * w3);
            }
        }

        // Hydrostatic: C = det(F) - gamma, recomputed from the corrected
        // positions. gamma = 1 + mu/lambda is exactly the offset that makes
        // F = I a stationary point of the combined energy, so a body at rest
        // neither collapses under the deviatoric term nor inflates.
        {
            let base = p[i0];
            let F = mat3x3f(p[i1] - base, p[i2] - base, p[i3] - base) * B;
            let ch = determinant(F) - b.gamma;

            let cofactor = mat3x3f(cross(F[1], F[2]), cross(F[2], F[0]), cross(F[0], F[1]));
            let g = cofactor * Bt;
            let g1 = g[0];
            let g2 = g[1];
            let g3 = g[2];
            let g0 = -(g1 + g2 + g3);

            let s = xpbdScale(ch, alphaHyd, g0, g1, g2, g3, w0, w1, w2, w3);
            p[i0] += g0 * (s * w0);
            p[i1] += g1 * (s * w1);
            p[i2] += g2 * (s * w2);
            p[i3] += g3 * (s * w3);
        }
    }

    for (var c = 0u; c < 8u; c++) {
        nodePos[ids[c]] = vec4f(p[c], 0.0);
    }
}
