// How a Gaussian rides the deformation, on the GPU. The maths, its conventions
// and the limit it accepts are written out in `covariance.js`, which is the CPU
// reference the unit tests pin; this file is the copy that runs.
//
// Pasted into somebody else's shader like the sampler, and under the same rule:
// every name introduced here begins `deform`. It uses the sampler only through
// the gradient handed to it, so a caller that wants Gaussians includes both and a
// caller that wants a surface includes one.
//
// What comes out is a covariance, because that is what an ellipsoid is. Restating
// it in whatever shape a particular renderer stores is that renderer's job -- see
// `render/ellipsoid.wgsl` for this one's.

// The rotation matrix of a unit quaternion. Column k is where basis vector k
// goes, which is what makes column k of `R diag(s)` the k-th axis of the
// ellipsoid.
fn deformQuaternionMatrix(q: vec4f) -> mat3x3f {
    let x = q.x; let y = q.y; let z = q.z; let w = q.w;
    return mat3x3f(
        vec3f(1.0 - 2.0 * (y * y + z * z), 2.0 * (x * y + z * w), 2.0 * (x * z - y * w)),
        vec3f(2.0 * (x * y - z * w), 1.0 - 2.0 * (x * x + z * z), 2.0 * (y * z + x * w)),
        vec3f(2.0 * (x * z + y * w), 2.0 * (y * z - x * w), 1.0 - 2.0 * (x * x + y * y))
    );
}

// The ellipsoid a Gaussian becomes under the field. `gradient` is the field's
// gradient at the splat's rest centre; `rotation` and `scale` are the splat as it
// was captured. The result is symmetric.
fn deformedCovariance(gradient: mat3x3f, rotation: vec4f, scale: vec3f) -> mat3x3f {
    // A = F R diag(s), one rest axis at a time, so that F S F^T = A A^T.
    let basis = deformQuaternionMatrix(rotation);
    let a = mat3x3f(
        gradient * basis[0] * scale.x,
        gradient * basis[1] * scale.y,
        gradient * basis[2] * scale.z
    );

    // `a * transpose(a)` and not the other order: the covariance is a sum over
    // the axes of their outer products, which is rows against rows.
    return a * transpose(a);
}
