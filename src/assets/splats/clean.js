/**
 * Throwing away the Gaussians that are not the object.
 *
 * This has to happen here, upstream of everything, and the reason is a rule
 * from the discretisation side: a rendered Gaussian that sits in a part of the
 * proxy geometry with no material reads a deformation gradient torn between
 * nodes that moved and nodes that have no mass, and shades as a black speck.
 * So whatever the simulation refuses to enclose must not be drawn either --
 * one cloud feeds both banks, and a filter that ran on only one of them would
 * break the invariant rather than enforce it.
 *
 * It also has to happen before the object can be measured at all. `bread.ply`
 * is 2.6 units across raw and 0.53 across once the near-transparent splats are
 * gone: five times too big, and no per-axis quantile catches it, because the
 * junk is not in the tails of the distribution -- it is 37% of the file.
 *
 * Only one filter exists here, and that is deliberate. Statistical outlier
 * removal and a maximum-size cut are the obvious next two, and on both assets
 * in this repository they have nothing left to do: after the opacity cut the
 * untrimmed extent already agrees with the 1-99% extent to within 5%. They go
 * in when a capture arrives that needs them.
 */

/** Below this, a Gaussian contributes nothing you can see. */
const DEFAULT_MIN_OPACITY = 0.1;

/**
 * @param {import('./cloud.js').SplatCloud} cloud - The cloud to filter.
 * @param {object} [options] - Filtering options.
 * @param {number} [options.minOpacity] - Gaussians fainter than this are dropped.
 * @returns {import('./cloud.js').SplatCloud} A new cloud; the input is untouched.
 */
export function cleanCloud(cloud, { minOpacity = DEFAULT_MIN_OPACITY } = {}) {
    const keep = [];
    for (let i = 0; i < cloud.count; i++) {
        if (cloud.opacity[i] >= minOpacity) {
            keep.push(i);
        }
    }
    return subsetCloud(cloud, keep);
}

/**
 * Takes the listed Gaussians and nothing else.
 *
 * Separate from the filter above because the hard part is not deciding what to
 * keep, it is keeping five parallel arrays in step while doing it. Any future
 * filter reuses this and cannot get that wrong.
 *
 * @param {import('./cloud.js').SplatCloud} cloud - The source.
 * @param {ArrayLike<number>} indices - Which Gaussians to keep, in output order.
 * @returns {import('./cloud.js').SplatCloud} A new cloud.
 */
export function subsetCloud(cloud, indices) {
    const count = indices.length;
    const out = {
        count,
        positions: new Float32Array(count * 3),
        rotations: new Float32Array(count * 4),
        scales: new Float32Array(count * 3),
        opacity: new Float32Array(count),
        colors: new Float32Array(count * 3)
    };

    for (let n = 0; n < count; n++) {
        const i = indices[n];
        for (let c = 0; c < 3; c++) {
            out.positions[n * 3 + c] = cloud.positions[i * 3 + c];
            out.scales[n * 3 + c] = cloud.scales[i * 3 + c];
            out.colors[n * 3 + c] = cloud.colors[i * 3 + c];
        }
        for (let c = 0; c < 4; c++) {
            out.rotations[n * 4 + c] = cloud.rotations[i * 4 + c];
        }
        out.opacity[n] = cloud.opacity[i];
    }
    return out;
}
