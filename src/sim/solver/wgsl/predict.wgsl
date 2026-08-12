// Substep prediction: symplectic Euler on the nodes.
//
// This is the whole of XPBD's time integration. Gauss-Seidel, which the spec
// called "time integration", is the ordering of a constraint's own sweep --
// see `constraints/wgsl/project.wgsl` -- a different axis entirely.
//
// The stepper opens every substep with this pass and closes it with
// `finalize.wgsl`. Whatever constraints run in between is not this file's
// business; it moves nodes it knows nothing else about.

uniform nodeCount: u32;
uniform dt: f32;
uniform gravity: vec3f;

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let n = gid.x;
    if (n >= uniform.nodeCount) {
        return;
    }
    // Inert nodes are lattice corners no cell touches, plus whatever a
    // constraint has prescribed for itself to drive this frame.
    if (nodeInvMass[n] == 0.0) {
        return;
    }

    let v = nodeVel[n].xyz + uniform.gravity * uniform.dt;
    let p = nodePos[n].xyz;

    nodePrev[n] = vec4f(p, 0.0);
    nodePos[n] = vec4f(p + v * uniform.dt, 0.0);
    nodeVel[n] = vec4f(v, 0.0);
}
