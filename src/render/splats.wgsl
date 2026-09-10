// Spliced into the engine's gsplat work buffer pass, which is where a splat is
// turned from what the capture stored into what the renderer draws. The engine
// publishes exactly these three names for the purpose and calls them once per
// splat; everything downstream -- sorting, projection, blending -- then works off
// the deformed cloud, which is the reason this hooks that pass rather than the
// final draw.
//
// This file is the adapter between the deformation channel and one engine. Both
// things it does are adapter's work: it knows this host's calling convention, and
// it knows this host's storage format.
//
// The centres, rotations and scales arriving here are in world space because
// the engine has already applied the entity/root transform. This lets imported
// source-space splats stay under their calibrated root while the simulation
// field remains a world-space field. PlayCanvas evaluates SH with a model-space
// view direction before applying this modifier, preserving the source basis.

// The gradient at the splat currently being processed, kept from the centre call
// for the shape call. `setWorkBufferModifier` splices this chunk into the work
// buffer bake and only there, and that pass calls the two back to back within one
// invocation, so the second may read what the first left. If it ever did not, the
// stash would be the zero matrix and the body would render as nothing at all --
// quiet enough to be worth naming here.
//
// Depending on that order is exactly what an adapter is for. The channel itself
// must not: a chunk pasted into somebody else's shader cannot assume how that
// somebody calls it, which is why `deformationAt` returns both answers at once
// and stays free of state. Asking it twice instead would be honest and cost every
// splat a second sampling of the field, every frame.
var<private> splatGradient: mat3x3f;
uniform inspectionColor: vec3f;
uniform inspectionMix: f32;
uniform deformationProbe: f32;

fn modifySplatCenter(center: ptr<function, vec3f>) {
    let deformation = deformationAt(*center);
    splatGradient = deformation.gradient;
    *center = deformation.position;
}

fn modifySplatRotationScale(
    originalCenter: vec3f,
    modifiedCenter: vec3f,
    rotation: ptr<function, vec4f>,
    scale: ptr<function, vec3f>
) {
    // The channel says what the ellipsoid is; this line says it in the shape the
    // engine's work buffer stores.
    let axes = ellipsoidAxes(deformedCovariance(splatGradient, *rotation, *scale));
    *rotation = axes.rotation;
    *scale = axes.scale;
}

fn modifySplatColor(center: vec3f, color: ptr<function, vec4f>) {
    *color = vec4f(
        mix((*color).rgb, uniform.inspectionColor, uniform.inspectionMix),
        (*color).a * (1.0 - uniform.deformationProbe)
    );
}
