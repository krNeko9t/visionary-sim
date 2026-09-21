// Spliced into the end of the engine's standard vertex shader, after it has
// written its own answers for a rigid object. Everything downstream -- lights,
// shadows, tone mapping -- then works off the deformed surface, which is the
// reason this hooks the engine's shader rather than replacing it.
//
// Wrapped in a block so its names cannot collide with the engine's locals.
{
    let rest = vertex_position.xyz;
    let deformation = deformationAt(rest);

    output.vPositionW = deformation.position;
    output.position = uniform.matrix_viewProjection * vec4f(deformation.position, 1.0);

    #ifdef NORMALS
        // Normals transform by the cofactor matrix, not by F: only the cofactor
        // keeps a normal perpendicular to a surface that F has sheared. Its
        // columns are the cross products of the other two columns of F, so
        // neither an inverse nor a determinant is needed. It reads only the
        // gradient, so it works over whatever sampler the field brings.
        let F = deformation.gradient;
        let cofactor = mat3x3f(cross(F[1], F[2]), cross(F[2], F[0]), cross(F[0], F[1]));
        output.vNormalW = normalize(cofactor * vertex_normal);
    #endif

    #ifdef LINEAR_DEPTH
        output.vLinearDepth = -(uniform.matrix_view * vec4f(deformation.position, 1.0)).z;
    #endif
}
