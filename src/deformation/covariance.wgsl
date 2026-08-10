// How a Gaussian rides the deformation, on the GPU. The maths, its conventions
// and the two limits it accepts are written out in `covariance.js`, which is the
// CPU reference the unit tests pin; this file is the copy that runs.
//
// Pasted into somebody else's shader like `sample.wgsl`, and under the same
// rule: every name introduced here begins `deform`. It uses `sample.wgsl` only
// through the gradient handed to it, so a caller that wants Gaussians includes
// both and a caller that wants a surface includes one.

struct DeformedGaussian {
    rotation: vec4f,   // xyzw, to match what the splat arrived as
    scale: vec3f,      // axis lengths, one standard deviation each
}

// The eigen-decomposition of a symmetric matrix: the axes as a rotation, and the
// value along each.
struct DeformEigen {
    orientation: vec4f,
    values: vec3f,
}

// See `covariance.js`: three sweeps is already below f32's noise, four costs
// twenty flops and buys the margin.
const DEFORM_SWEEPS: u32 = 4u;

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

// The product whose matrix is `matrix(a) * matrix(b)`. `b` need not be unit.
fn deformQuaternionProduct(a: vec4f, b: vec4f) -> vec4f {
    return vec4f(
        a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
        a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
    );
}

// Cyclic Jacobi. Held as a flat array rather than a mat3x3f because the indices
// are computed, and carried as a quaternion because that is what the caller
// wants back.
fn deformDiagonalize(m: mat3x3f) -> DeformEigen {
    var a = array<f32, 9>(
        m[0][0], m[0][1], m[0][2],
        m[1][0], m[1][1], m[1][2],
        m[2][0], m[2][1], m[2][2]
    );
    var q = vec4f(0.0, 0.0, 0.0, 1.0);

    for (var sweep = 0u; sweep < DEFORM_SWEEPS; sweep++) {
        // (p, r, other) cyclic, so the plane's normal is always +other and the
        // quaternion needs no parity correction. The three cyclic triples still
        // cover all three off-diagonal entries.
        for (var p = 0u; p < 3u; p++) {
            let r = (p + 1u) % 3u;
            let other = (p + 2u) % 3u;
            let apr = a[r * 3u + p];
            if (apr == 0.0) {
                continue;
            }

            // The angle that zeroes a[p][r]; of the two, the smaller, which is
            // what keeps the sweeps convergent.
            let app = a[p * 3u + p];
            let arr = a[r * 3u + r];
            let theta = (arr - app) / (2.0 * apr);
            let sign = select(-1.0, 1.0, theta >= 0.0);
            let tangent = sign / (abs(theta) + sqrt(theta * theta + 1.0));
            let cosine = inverseSqrt(tangent * tangent + 1.0);
            let sine = tangent * cosine;

            let apo = a[other * 3u + p];
            let aro = a[other * 3u + r];
            let turnedP = cosine * apo - sine * aro;
            let turnedR = sine * apo + cosine * aro;
            a[p * 3u + p] = app - tangent * apr;
            a[r * 3u + r] = arr + tangent * apr;
            a[r * 3u + p] = 0.0;
            a[p * 3u + r] = 0.0;
            a[other * 3u + p] = turnedP;
            a[p * 3u + other] = turnedP;
            a[other * 3u + r] = turnedR;
            a[r * 3u + other] = turnedR;

            // The plane rotation as a quaternion, via the half-angle tangent
            // `sin / (1 + cos)`. Not through `sqrt((1 - cos) / 2)`, which is the
            // same number reached through a subtraction that cancels for exactly
            // the small angles the late sweeps are made of.
            let half = -(sine / (1.0 + cosine));
            let imaginary = vec3f(
                f32(other == 0u), f32(other == 1u), f32(other == 2u)
            ) * half;
            q = normalize(deformQuaternionProduct(q, vec4f(imaginary, 1.0)));
        }
    }

    return DeformEigen(q, vec3f(a[0], a[4], a[8]));
}

// Where a Gaussian's axes go. `gradient` is the field's gradient at the splat's
// rest centre; `rotation` and `scale` are the splat as it was captured.
fn deformedGaussian(gradient: mat3x3f, rotation: vec4f, scale: vec3f) -> DeformedGaussian {
    // A = F R diag(s), one rest axis at a time, so that F S F^T = A A^T.
    let basis = deformQuaternionMatrix(rotation);
    let a = mat3x3f(
        gradient * basis[0] * scale.x,
        gradient * basis[1] * scale.y,
        gradient * basis[2] * scale.z
    );

    // `a * transpose(a)` and not the other order: the covariance is a sum over
    // the axes of their outer products, which is rows against rows.
    let eigen = deformDiagonalize(a * transpose(a));

    // Negative values are rounding around zero, not a shape. A cell crushed flat
    // lands here legitimately, and should give an axis length of zero rather
    // than a NaN that takes the whole splat with it.
    return DeformedGaussian(eigen.orientation, sqrt(max(eigen.values, vec3f(0.0))));
}
