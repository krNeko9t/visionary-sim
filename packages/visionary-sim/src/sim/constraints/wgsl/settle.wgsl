// Pass four of four: apply what each node gathered, and leave the grid as it
// was found.
//
// The average, not the sum. A node wedged between two others is asked by both
// to move all the way out, and doing both would launch it; Jacobi's price for
// having no order is that the answers have to be reconciled afterwards, and the
// mean is the cheapest reconciliation that cannot overshoot. A `gain` above 1
// trades that guarantee for faster separation.
//
// (`gain` and not "relaxation": the material already spends that word on its
// Kelvin-Voigt time, and the two have nothing to do with each other.)
//
// The clearing is here rather than in a fifth pass because this is the last
// thing that happens in a substep: the invariant is that the grid is empty
// between substeps, and the way to keep an invariant is to restore it where it
// is broken. Only the counters need it -- a slot past its bucket's count is
// never read.

uniform gain: f32;

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let i = gid.x;

    if (i < uniform.surfaceCount) {
        let delta = surface[i].delta;
        if (delta.w > 0.0) {
            let node = surface[i].node;
            let step = delta.xyz * (uniform.gain / delta.w);
            nodePos[node] = vec4f(nodePos[node].xyz + step, 0.0);
        }
    }

    if (i < uniform.bucketCount) {
        atomicStore(&contactGrid[i], 0u);
    }
}
