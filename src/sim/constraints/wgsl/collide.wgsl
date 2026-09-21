// Pass two of three: each boundary node looks around its own bucket and the
// twenty-six touching it, and works out what it would take to stop overlapping
// whatever it finds there.
//
// Nothing is written to a position here. A thread accumulates into its own
// record and reads nobody's, so the pass has no order to it and no atomics in
// it: the only writes are `surface[s].delta`, and s is the thread. That is what
// Jacobi buys, and `settle.wgsl` pays for it by having to average.
//
// A body is a union of spheres centred on the nodes its proxy offers for
// contact, each as wide as the proxy chose to seal its surface (ADR-0008). So
// contact resolves at the proxy's resolution, not the render surface's, and two
// bodies come to rest about one node spacing apart. Sharper contact means a
// different representation of the surface, not a different solver.

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let s = gid.x;
    if (s >= uniform.surfaceCount) {
        return;
    }

    // Read the fields, not the struct: `delta` is being written by every other
    // thread in this dispatch, and a whole-struct load would be reading it.
    let node = surface[s].node;
    let body = surface[s].body;
    let radius = surface[s].radius;

    let wi = nodeInvMass[node];
    let pi = nodePos[node].xyz;
    let movedI = pi - nodePrev[node].xyz;
    let frictionI = nodeParams[body].friction;

    var sum = vec3f(0.0);
    var hits = 0.0;

    let centre = vec3i(gridCoord(pi));
    let dims = vec3i(uniform.gridDims);

    for (var dz = -1; dz <= 1; dz++) {
        let z = centre.z + dz;
        if (z < 0 || z >= dims.z) {
            continue;
        }
        for (var dy = -1; dy <= 1; dy++) {
            let y = centre.y + dy;
            if (y < 0 || y >= dims.y) {
                continue;
            }
            for (var dx = -1; dx <= 1; dx++) {
                let x = centre.x + dx;
                if (x < 0 || x >= dims.x) {
                    continue;
                }

                let bucket = bucketAt(vec3u(u32(x), u32(y), u32(z)));
                let held = min(atomicLoad(&contactGrid[bucket]), BUCKET_SLOTS);
                let base = uniform.bucketCount + bucket * BUCKET_SLOTS;

                for (var k = 0u; k < held; k++) {
                    let other = atomicLoad(&contactGrid[base + k]);
                    let mateBody = surface[other].body;
                    // Two nodes of one body are held together by elasticity.
                    // Asking them to also not overlap would fight it, and at
                    // rest they are already closer than a contact diameter.
                    if (mateBody == body) {
                        continue;
                    }

                    let mate = surface[other].node;
                    let pj = nodePos[mate].xyz;
                    let d = pi - pj;
                    // Squared until an overlap is certain: the square root is
                    // only needed once there is a correction to scale.
                    let dist2 = dot(d, d);
                    let reach = radius + surface[other].radius;
                    if (dist2 >= reach * reach) {
                        continue;
                    }

                    let wj = nodeInvMass[mate];
                    let total = wi + wj;
                    if (total <= 0.0) {
                        continue;
                    }
                    // The heavier node gives way less. Both threads compute the
                    // same split from the same two masses, so the pair's two
                    // halves agree without ever talking.
                    let share = wi / total;

                    let dist = sqrt(dist2);
                    // Exactly coincident nodes have no direction to separate
                    // along, so one is derived from their indices. It has to be
                    // antisymmetric or the pair would drift together instead of
                    // apart, hence the comparison rather than a constant.
                    var normal = vec3f(0.0, select(-1.0, 1.0, node < mate), 0.0);
                    if (dist > 1e-9) {
                        normal = d / dist;
                    }
                    let depth = reach - dist;
                    var correction = normal * (depth * share);

                    // Coulomb friction at the position level, as in the tank's
                    // planes: cancel the sliding that has happened since the
                    // substep began, but never more than `mu` times the normal
                    // correction. Below the limit the pair sticks, above it
                    // slides. The plane case is the same rule with one of the
                    // two motions identically zero.
                    let sliding = movedI - (pj - nodePrev[mate].xyz);
                    let tangent = sliding - normal * dot(sliding, normal);
                    let slid = length(tangent);
                    if (slid > 1e-9) {
                        let mu = min(frictionI, nodeParams[mateBody].friction);
                        correction -= tangent * (share * min(1.0, mu * depth / slid));
                    }

                    sum += correction;
                    hits += 1.0;
                }
            }
        }
    }

    surface[s].delta = vec4f(sum, hits);
}
