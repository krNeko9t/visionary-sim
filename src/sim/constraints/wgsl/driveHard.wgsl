// The hard drive law: a driven node carries zero inverse mass --
// `kinematicDrive.js` is what asks `sim/state` to make that so, through
// `Particles.setPrescribed` -- and this kernel is the only thing that still
// moves it. It stands in for both `predict.wgsl` and `finalize.wgsl` on
// exactly these nodes, in one pass, which is why it writes all three
// histories a normal node gets from the two of them combined.
//
// Advancing by the handle's own velocity, capped at the remaining distance,
// is what spreads one frame's whole displacement across every substep that
// frame instead of covering it on the first substep and sitting still for
// the rest -- the handle's motion during a frame is unknown until the frame
// is over, so `handleVelocity` here is already that frame's average, set
// once by whoever dispatches this pass.

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let i = gid.x;
    if (i >= uniform.drivenCount) {
        return;
    }

    let d = driven[i];
    let n = d.node;
    let here = nodePos[n].xyz;
    let goal = uniform.handleTarget + d.offset.xyz;
    let step = uniform.handleVelocity * uniform.dt;
    let toGoal = goal - here;
    // Once this substep's step would reach or pass the goal, land on it
    // exactly instead of overshooting past it.
    let next = here + select(step, toGoal, dot(step, step) >= dot(toGoal, toGoal));

    nodePrev[n] = vec4f(here, 0.0);
    nodePos[n] = vec4f(next, 0.0);
    nodeVel[n] = vec4f((next - here) / uniform.dt, 0.0);
}
