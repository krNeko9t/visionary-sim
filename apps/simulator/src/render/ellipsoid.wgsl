// Stating an ellipsoid the way this engine's splat buffer wants it: a rotation
// and three axis lengths, out of a covariance. The reasoning, the precision
// argument and the sweep count are in `ellipsoid.js`, which is the CPU reference
// the unit tests pin; this file is the copy that runs.
//
// Pasted into the engine's shader, so every name introduced here begins
// `ellipsoid`. It knows nothing about deformation -- it takes a covariance from
// wherever and takes it apart.

struct EllipsoidAxes {
    rotation: vec4f,   // xyzw, to match what the splat arrived as
    scale: vec3f,      // axis lengths, one standard deviation each
}

// See `ellipsoid.js`: three sweeps is already below f32's noise, four costs
// twenty flops and buys the margin.
const ELLIPSOID_SWEEPS: u32 = 4u;

// The product whose matrix is `matrix(a) * matrix(b)`. `b` need not be unit.
fn ellipsoidQuaternionProduct(a: vec4f, b: vec4f) -> vec4f {
    return vec4f(
        a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
        a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
    );
}

// Cyclic Jacobi. Held as a flat array rather than a mat3x3f because the indices
// are computed, and the accumulated rotation is carried as a quaternion because
// that is what the caller wants back.
fn ellipsoidAxes(m: mat3x3f) -> EllipsoidAxes {
    var a = array<f32, 9>(
        m[0][0], m[0][1], m[0][2],
        m[1][0], m[1][1], m[1][2],
        m[2][0], m[2][1], m[2][2]
    );
    var q = vec4f(0.0, 0.0, 0.0, 1.0);

    for (var sweep = 0u; sweep < ELLIPSOID_SWEEPS; sweep++) {
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
            q = normalize(ellipsoidQuaternionProduct(q, vec4f(imaginary, 1.0)));
        }
    }

    // Negative values are rounding around zero, not a shape. An ellipsoid crushed
    // flat is a legitimate thing to be handed, and should give an axis length of
    // zero rather than a NaN that takes the whole splat with it.
    return EllipsoidAxes(q, sqrt(max(vec3f(a[0], a[4], a[8]), vec3f(0.0))));
}
