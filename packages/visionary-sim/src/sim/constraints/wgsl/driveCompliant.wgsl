// The compliant drive law: a driven node keeps its mass, so elasticity,
// contact and the tank can all still move it. This kernel only nudges
// position -- it is a projection alongside the elastic constraint's own, not
// a replacement for `predict.wgsl` or `finalize.wgsl`, and must not touch
// `nodePrev` or `nodeVel` for exactly that reason. Velocity still comes from
// `finalize`, reading whatever this pass and everything after it did to the
// position, which is what gives this law genuine momentum: move the grab
// target and a held node accelerates toward it rather than teleporting.
//
// Point constraint C = p - goal, solved as three independent axes with
// gradient 1 and compliance alpha = w * tau^2 (tau = `responseTime`). One
// XPBD iteration from lambda = 0 gives dLambda = -C / (w + alpha/dt^2), and
// the correction is dp = w * dLambda:
//
//   dp = -w*C / (w + w*tau^2/dt^2) = -C / (1 + tau^2/dt^2) = (goal - p) * dt^2/(dt^2 + tau^2)
//
// The node's own inverse mass cancels out completely. That is what keeps a
// held node's pull toward its goal from depending on how heavy it is or
// how many other nodes are held alongside it -- the fraction of the distance
// closed this substep is the same number for all of them. tau -> 0 makes
// this identical to the hard law's goal; tau -> infinity leaves position
// alone.

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let i = gid.x;
    if (i >= params.drivenCount) {
        return;
    }

    let d = driven[i];
    let n = d.node;
    let goal = params.grabTarget + d.offset.xyz;
    let p = nodePos[n].xyz;

    let dt2 = params.dt * params.dt;
    let tau2 = params.responseTime * params.responseTime;
    let frac = dt2 / (dt2 + tau2);

    nodePos[n] = vec4f(p + (goal - p) * frac, 0.0);
}
