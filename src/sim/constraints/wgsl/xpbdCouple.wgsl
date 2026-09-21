// XPBD multipliers for the two constraints of one element, solved together as
// a 2x2 block.
//
// The stable Neo-Hookean pair of `compliance.js`, and nothing about how the
// elements were made: whoever owns the elements works out `c`, the gradients
// and their `gram`, and pastes this file into its kernel to turn them into
// multipliers.
//
// Lambda is deliberately not accumulated: with one projection per substep it
// starts at zero, so the `alpha * lambda` term of the full XPBD update is
// identically zero and the block reduces to `A dLambda = -C`. That is the
// "small steps" regime, and it saves a per-constraint buffer. Running more than
// one iteration per substep would require storing lambda.
//
// Solving the two together rather than one after the other is what lets the
// material be compressible. Projected in turn they are damped by different
// amounts -- at rest `grad C_H = sqrt(3) grad C_D`, so the two denominators
// differ -- and the corrections that ought to cancel at `F = I` instead leave a
// net shrink per pair, which compounds until the body is a point. Only a
// hydrostatic constraint stiff enough to lock the volume outright stopped it,
// which is why gamma had to stay near 1.
//
// Solved together they cancel at `F = I` exactly, for every gamma, dt, volume
// and mass. There the two gradients are parallel, so the block moves the nodes
// along that one direction by `dLambdaD + sqrt(3) dLambdaH`, which works out to
// `sqrt(3) (alphaDev * mu / lambda - alphaHyd) / det`, and `alphaDev * mu /
// lambda` *is* `alphaHyd`: both are `1 / (lambda * V)`. Rest is a fixed point of
// the solver rather than something a stiff constraint holds it near.
//
// `A` cannot be singular. Its off-diagonal is a Cauchy-Schwarz inner product of
// the two gradient sets, so `det >= alphaDev * alphaHyd > 0` however parallel
// they become; the epsilon below is against underflow, not against the maths.
//
// `gram` is `(sum w |grad C_D|^2, sum w grad C_D . grad C_H, sum w |grad C_H|^2)`
// -- what the constraints contribute to the block. The compliances are added
// here so that no caller has to remember them.
//
// `relax` is XPBD's damping coefficient (Macklin 2016 calls it gamma, which this
// codebase has already spent on the Neo-Hookean rest offset -- they are
// unrelated). It enters as `(1 + relax)` on the gradient part and as
// `relax * grad C . dx` in the residual, where `dx` is the motion since the
// substep began. Since `grad C . dx` is `dC/dt * dt`, the residual reads
// `C + (relax * dt) * dC/dt`: a Kelvin-Voigt element whose relaxation time is
// `relax * dt`. That product is the quantity with physical meaning, so the
// material stores the time in seconds and the kernel divides by the substep.
//
// Two things this damping deliberately cannot do, both because every gradient
// set sums to zero: it cannot slow a body that is merely translating, and it
// cannot slow one that is merely spinning -- `grad C . dx` vanishes for any
// motion that does not change the deformation gradient. It removes energy from
// deformation only, which is what the plain velocity drag in the stepper's
// finalize pass cannot distinguish.
//
// At `relax = 0` this reduces to the undamped block exactly. At rest it returns
// zero however large `relax` is: `dx` contributes nothing there, and scaling the
// whole gradient part by `(1 + relax)` leaves the cancellation of the previous
// paragraph untouched.
fn xpbdCouple(c: vec2f, alpha: vec2f, relax: f32, rate: vec2f, gram: vec3f) -> vec2f {
    let stiffened = 1.0 + relax;
    let a00 = gram.x * stiffened + alpha.x;
    let a01 = gram.y * stiffened;
    let a11 = gram.z * stiffened + alpha.y;

    let det = a00 * a11 - a01 * a01;
    if (det < 1e-20) {
        return vec2f(0.0, 0.0);
    }

    let rhs = -(c + rate * relax);
    return vec2f(a11 * rhs.x - a01 * rhs.y, a00 * rhs.y - a01 * rhs.x) / det;
}
