// What the kinematic drive constraint needs on top of the particle
// declarations: which nodes it is driving this substep, where the handle
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
    // Offset from the handle anchor at the moment this node was taken up.
    // Adding it to `handleTarget` every substep is what makes a held set
    // translate rigidly with the handle rather than collapse onto one point.
    // w unused.
    offset: vec4f,
}

var<storage, read> driven: array<Driven>;

uniform handleTarget: vec3f;
uniform handleVelocity: vec3f;
uniform drivenCount: u32;
uniform dt: f32;
// Compliant law only: see `wgsl/driveCompliant.wgsl` for what this means
// physically. The hard law ignores it.
uniform responseTime: f32;
