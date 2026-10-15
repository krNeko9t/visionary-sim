// Pass one of four: put every boundary node into the grid bucket it currently
// occupies.
//
// This is the whole broadphase. It is rebuilt from nothing every substep, which
// sounds wasteful and is not: the bodies have moved, the buckets are a plain
// array of counters, and one atomic increment per node is cheaper than any
// scheme that tries to update a structure in place.

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let s = gid.x;
    if (s >= params.surfaceCount) {
        return;
    }

    let bucket = bucketAt(gridCoord(nodePos[surface[s].node].xyz));
    let slot = atomicAdd(&contactGrid[bucket], 1u);
    // Arrival order is unspecified, so this is not yet an order collision may
    // use. The following sort pass owns each bucket and canonicalises it.
    if (slot < BUCKET_SLOTS) {
        atomicStore(&contactGrid[params.bucketCount + bucket * BUCKET_SLOTS + slot], s);
    }
}
