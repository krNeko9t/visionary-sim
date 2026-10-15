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
// The centres arriving here are in world space, because the engine has already
// applied the entity's transform. `splats.js` keeps that transform at identity so
// that they are also rest-space positions, which is what the field expects.

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

// Colour rides along unchanged. A capture's colour is a property of the surface,
// not of where the surface currently is.
fn modifySplatColor(center: vec3f, color: ptr<function, vec4f>) {
}
