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
        output.vNormalW = deformedNormal(deformation.gradient, vertex_normal);
    #endif

    #ifdef LINEAR_DEPTH
        output.vLinearDepth = -(uniform.matrix_view * vec4f(deformation.position, 1.0)).z;
    #endif
}
