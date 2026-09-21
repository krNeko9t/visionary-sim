// How a surface rides the deformation, on the GPU. Pasted into somebody else's
// shader after the field's own text, like `covariance.wgsl`. It uses the field
// only through the gradient handed to it, so it works over whatever sampler the
// field brings.

// Normals transform by the cofactor matrix, not by F: only the cofactor keeps a
// normal perpendicular to a surface that F has sheared. Its columns are the
// cross products of the other two columns of F, so neither an inverse nor a
// determinant is needed.
fn deformedNormal(gradient: mat3x3f, restNormal: vec3f) -> vec3f {
    let cofactor = mat3x3f(
        cross(gradient[1], gradient[2]),
        cross(gradient[2], gradient[0]),
        cross(gradient[0], gradient[1])
    );
    return normalize(cofactor * restNormal);
}
