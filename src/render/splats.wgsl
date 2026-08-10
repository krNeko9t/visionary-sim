// Spliced into the engine's gsplat work buffer pass, which is where a splat is
// turned from what the capture stored into what the renderer draws. The engine
// publishes exactly these three names for the purpose and calls them once per
// splat; everything downstream -- sorting, projection, blending -- then works off
// the deformed cloud, which is the reason this hooks that pass rather than the
// final draw.
//
// The centres arriving here are in world space, because the engine has already
// applied the entity's transform. `splats.js` keeps that transform at identity
// so that they are also rest-space positions, which is what the field expects.

fn modifySplatCenter(center: ptr<function, vec3f>) {
    *center = deformationAt(*center).position;
}

// `originalCenter` is the rest centre, before this file moved it, so the field
// can be asked about it a second time. That is one extra trilinear fetch per
// splat, and it is paid on purpose: the alternative is to stash the gradient
// from the call above in a module-scope variable, which would make this file
// correct only for callers that invoke the two in order. The engine does, in all
// three of its passes -- but a chunk pasted into somebody else's shader should
// not need that to be true.
fn modifySplatRotationScale(
    originalCenter: vec3f,
    modifiedCenter: vec3f,
    rotation: ptr<function, vec4f>,
    scale: ptr<function, vec3f>
) {
    let moved = deformedGaussian(
        deformationAt(originalCenter).gradient, *rotation, *scale
    );
    *rotation = moved.rotation;
    *scale = moved.scale;
}

// Colour rides along unchanged. A capture's colour is a property of the surface,
// not of where the surface currently is.
fn modifySplatColor(center: vec3f, color: ptr<function, vec4f>) {
}
