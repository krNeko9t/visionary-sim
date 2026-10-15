struct Params {
    nodeCount: u32,
    dt: f32,
    tankMin: vec3f,
    tankMax: vec3f,
}
@group(0) @binding(7) var<uniform> params: Params;

// The substep's closing pass: the tank boundary, then velocities read back off
// the positions the constraints left behind.
//
// These are one kernel rather than two because both are per-node and strictly
// adjacent: the boundary must land after every constraint has projected and
// before velocities are derived. Merging them saves a dispatch per substep, and
// at ten-plus substeps a frame that is worth having.
//
// The tank is here rather than among the constraints because it is a property
// of the world, fixed and known, not of any object -- five planes that never
// move and never have to be discovered. Contact *between bodies* is the
// opposite on every count, which is why it arrives as a constraint set of its
// own rather than as more planes in this file.


// Resolves one half-space, normal pointing into the valid region.
//
// Friction is the position-level Coulomb model: the tangential motion since the
// start of the substep is cancelled, but by no more than `friction` times the
// normal correction. Below that limit contact is sticking, above it sliding.
fn resolvePlane(p: vec3f, prev: vec3f, normal: vec3f, depth: f32, friction: f32) -> vec3f {
    if (depth <= 0.0) {
        return p;
    }
    var q = p + normal * depth;

    let delta = q - prev;
    let tangent = delta - normal * dot(delta, normal);
    let len = length(tangent);
    if (len > 1e-9) {
        q -= tangent * min(1.0, friction * depth / len);
    }
    return q;
}

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let n = gid.x;
    if (n >= params.nodeCount) {
        return;
    }

    let np = nodeParams[bodyOfNode(n)];
    let prev = nodePrev[n].xyz;
    var p = nodePos[n].xyz;

    // Zero inverse mass -- inactive, statically or kinematically prescribed --
    // means this pass leaves its position and velocity alone.
    if (nodeInvMass[n] == 0.0) {
        return;
    }

    // The tank is open at the top, so there is no y = max plane.
    let fr = np.friction;
    p = resolvePlane(p, prev, vec3f(0.0, 1.0, 0.0), params.tankMin.y - p.y, fr);
    p = resolvePlane(p, prev, vec3f(1.0, 0.0, 0.0), params.tankMin.x - p.x, fr);
    p = resolvePlane(p, prev, vec3f(-1.0, 0.0, 0.0), p.x - params.tankMax.x, fr);
    p = resolvePlane(p, prev, vec3f(0.0, 0.0, 1.0), params.tankMin.z - p.z, fr);
    p = resolvePlane(p, prev, vec3f(0.0, 0.0, -1.0), p.z - params.tankMax.z, fr);

    nodePos[n] = vec4f(p, 0.0);

    var v = (p - prev) / params.dt;
    v *= exp(-np.damping * params.dt);
    nodeVel[n] = vec4f(v, 0.0);
}
