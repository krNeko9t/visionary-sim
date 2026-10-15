struct Params {
    grabTarget: vec3f,
    grabTargetVelocity: vec3f,
    drivenCount: u32,
    dt: f32,
    responseTime: f32,
}
@group(0) @binding(7) var<uniform> params: Params;

// What the kinematic drive constraint needs on top of the particle
// declarations: which nodes it is driving this substep, where the grab target
// currently is, and (for the compliant law only) how stiffly it is held.
//
// `kinematicDrive.js` prepends `state.wgsl` and then this file to each of its
// two kernels, one per drive law. Both kernels get every field here, whether
// or not they read it, so the two share one uniform buffer layout -- the same
// arrangement `contacts.wgsl` uses for its four passes.

// One record per node currently held.
//
// Sized to a fixed capacity rather than grown with the held set: the set
// changes on every fresh hold, in a real session that means every pointer
// press, and a fixed-capacity buffer with a live count is one write instead
// of a reallocation. See `drivenCount` below for how far into it a kernel
// should actually read.
struct Driven {
    node: u32,
    pad0: u32,
    pad1: u32,
    pad2: u32,
    // Offset from the anchor at the moment this node was taken up -- the
    // grab target starts on the anchor, so this is also the offset from it.
    // Adding it to `grabTarget` every substep is what makes a held set
    // translate rigidly with the grab target rather than collapse onto one
    // point.
    // w unused.
    offset: vec4f,
}

@group(0) @binding(5) var<storage, read> driven: array<Driven>;

// Compliant law only: see `wgsl/driveCompliant.wgsl` for what this means
// physically. The hard law ignores it.
