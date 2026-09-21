import { subsetCloud } from '../assets/splats/clean.js';

/**
 * One scene-owned region shared by Gaussian centres and rest-world nodes.
 * The balanced k-d tree only prunes points farther than r along a split axis;
 * every candidate still uses Euclidean distance, including the boundary.
 * Neither simulation resolution nor Gaussian extent enters this declaration.
 *
 * @param {ArrayLike<number>} samples - Flat xyz samples, in world metres.
 * @param {number} r - Non-negative distance tolerance in metres; no default.
 *   Zero includes only exactly coincident samples. Empty samples are all static.
 * @returns {{movable: (x: number, y: number, z: number) => boolean,
 *   staticRegion: (x: number, y: number, z: number) => boolean}} Region predicates.
 */
export function createMetricRegion(samples, r) {
    if (!Number.isFinite(r) || r < 0) {
        throw new TypeError('metric region tolerance must be a finite non-negative number');
    }
    if (!samples || typeof samples !== 'object' || !Number.isSafeInteger(samples.length) ||
        samples.length < 0 || samples.length % 3 !== 0) {
        throw new TypeError('metric region samples must be flat xyz coordinates');
    }
    const points = [];
    for (let i = 0; i < samples.length; i += 3) {
        finitePosition(samples[i], samples[i + 1], samples[i + 2], `samples at offset ${i}`);
        points.push([samples[i], samples[i + 1], samples[i + 2]]);
    }
    const build = (items, depth = 0) => {
        if (!items.length) return null;
        const axis = depth % 3;
        items.sort((a, b) => a[axis] - b[axis]);
        const middle = Math.floor(items.length / 2);
        return {
            point: items[middle], axis,
            left: build(items.slice(0, middle), depth + 1),
            right: build(items.slice(middle + 1), depth + 1)
        };
    };
    const root = build(points);
    const contains = (node, query) => {
        if (!node) return false;
        const { point, axis, left, right } = node;
        if (Math.hypot(query[0] - point[0], query[1] - point[1], query[2] - point[2]) <= r) {
            return true;
        }
        const delta = query[axis] - point[axis];
        const near = delta <= 0 ? left : right;
        const far = delta <= 0 ? right : left;
        return contains(near, query) || (Math.abs(delta) <= r && contains(far, query));
    };
    const movable = (x, y, z) => {
        finitePosition(x, y, z, 'query');
        return contains(root, [x, y, z]);
    };
    return { movable, staticRegion: (x, y, z) => !movable(x, y, z) };
}

function finitePosition(x, y, z, label) {
    if (![x, y, z].every(Number.isFinite)) {
        throw new TypeError(`metric region ${label} must contain finite xyz coordinates`);
    }
}

/**
 * Partition a foreground that has already been cleaned once as a whole.
 * Each Gaussian is classified exactly once by its centre, regardless of scale
 * or rotation. Both outputs preserve source order and all cloud attributes;
 * the caller keeps the complete source for simulation. Empty outputs are valid
 * clouds, but their render resources must be skipped by the scene assembler.
 *
 * @param {import('../assets/splats/cloud.js').SplatCloud} cloud - Clean foreground.
 * @param {ReturnType<typeof createMetricRegion>} region - The shared world region.
 * @returns {{movable: import('../assets/splats/cloud.js').SplatCloud,
 *   fixed: import('../assets/splats/cloud.js').SplatCloud}} Disjoint complete subsets.
 */
export function splitCloudByRegion(cloud, region) {
    const movable = [];
    const fixed = [];
    for (let i = 0; i < cloud.count; i++) {
        const p = i * 3;
        const target = region.movable(cloud.positions[p], cloud.positions[p + 1], cloud.positions[p + 2])
            ? movable : fixed;
        target.push(i);
    }
    return { movable: subsetCloud(cloud, movable), fixed: subsetCloud(cloud, fixed) };
}
