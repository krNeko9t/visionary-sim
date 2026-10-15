// Between binning and collision, put each bucket's live entries in one
// canonical order.
//
// Atomic insertion decides which thread reaches a bucket first; using that
// order directly changes both f32 summation order and, at capacity, which
// neighbours survive. The difference is physically tiny but contact amplifies
// it: identical one-second runs used to diverge by tenths of a millimetre.
//
// One thread owns one bucket here, so a local insertion sort needs no barrier
// and no second buffer. Occupancy is normally a handful of nodes; empty
// buckets return immediately. This is a bounded local canonicalisation, not the
// global GPU sort that a variable-length contact-pair table would require.

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let bucket = gid.x;
    if (bucket >= params.bucketCount) {
        return;
    }

    let count = atomicLoad(&contactGrid[bucket]);
    let base = params.bucketCount + bucket * BUCKET_SLOTS;
    // Overflow is exceptional, but it cannot be allowed to reintroduce arrival
    // order through the set that survived. Re-scan surface records in index
    // order and keep the first K that belong to this bucket: those are exactly
    // the deterministic lowest K. Normal buckets avoid this scan entirely.
    if (count > BUCKET_SLOTS) {
        var kept = 0u;
        for (var s = 0u; s < params.surfaceCount && kept < BUCKET_SLOTS; s++) {
            let at = bucketAt(gridCoord(nodePos[surface[s].node].xyz));
            if (at == bucket) {
                atomicStore(&contactGrid[base + kept], s);
                kept++;
            }
        }
        return;
    }

    let held = count;
    for (var i = 1u; i < held; i++) {
        let value = atomicLoad(&contactGrid[base + i]);
        var at = i;
        while (at > 0u) {
            let previous = atomicLoad(&contactGrid[base + at - 1u]);
            if (previous <= value) {
                break;
            }
            atomicStore(&contactGrid[base + at], previous);
            at--;
        }
        atomicStore(&contactGrid[base + at], value);
    }
}
