// Contacts against the tank, then the substep's velocity update.
//
// These are one kernel rather than two because both are per-node and strictly
// adjacent: contacts must land after the elastic solve and before velocities
// are read back off the positions. Merging them saves a dispatch per substep,
// and at ten-plus substeps a frame that is worth having.

uniform nodeCount: u32;
uniform dt: f32;
uniform tankMin: vec3f;
uniform tankMax: vec3f;
uniform grabTarget: vec3f;

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
    if (n >= uniform.nodeCount) {
        return;
    }

    let b = bodies[bodyOfNode(n)];
    let prev = nodePrev[n].xyz;
    var p = nodePos[n].xyz;

    // A grabbed node is driven, not simulated: it is pinned to the pointer ray
    // and keeps whatever velocity that implies.
    if (b.grabNode >= 0 && u32(b.grabNode) == n) {
        nodePos[n] = vec4f(uniform.grabTarget, 0.0);
        nodeVel[n] = vec4f((uniform.grabTarget - prev) / uniform.dt, 0.0);
        return;
    }

    if (nodeInvMass[n] == 0.0) {
        return;
    }

    // The tank is open at the top, so there is no y = max plane.
    let fr = b.friction;
    p = resolvePlane(p, prev, vec3f(0.0, 1.0, 0.0), uniform.tankMin.y - p.y, fr);
    p = resolvePlane(p, prev, vec3f(1.0, 0.0, 0.0), uniform.tankMin.x - p.x, fr);
    p = resolvePlane(p, prev, vec3f(-1.0, 0.0, 0.0), p.x - uniform.tankMax.x, fr);
    p = resolvePlane(p, prev, vec3f(0.0, 0.0, 1.0), uniform.tankMin.z - p.z, fr);
    p = resolvePlane(p, prev, vec3f(0.0, 0.0, -1.0), p.z - uniform.tankMax.z, fr);

    nodePos[n] = vec4f(p, 0.0);

    var v = (p - prev) / uniform.dt;
    v *= exp(-b.damping * uniform.dt);
    nodeVel[n] = vec4f(v, 0.0);
}
