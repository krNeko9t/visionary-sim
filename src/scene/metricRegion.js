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
 * Extend measured material labels into the volume inferred around a scan.
 * A sample retains its original label. Between samples, the nearest foreground
 * sample owns the label (ties use source order). Otherwise the outside corners
 * of a thin leaf become world attachments merely because the proxy has a
 * thickness and the scan does not. Background must never enter these samples.
 *
 * @param {ArrayLike<number>} positions - Clean foreground xyz measurements.
 * @param {{movable: (x: number, y: number, z: number) => boolean}} measured - Labels at measured positions.
 * @returns {{movable: (x: number, y: number, z: number) => boolean, staticRegion: (x: number, y: number, z: number) => boolean}}
 */
export function extendMaterialRegion(positions, measured) {
    if (!positions || typeof positions !== 'object' || !Number.isSafeInteger(positions.length) ||
        positions.length < 0 || positions.length % 3 !== 0) {
        throw new TypeError('material samples must be flat xyz coordinates');
    }
    const points = [];
    for (let i = 0; i < positions.length; i += 3) {
        const p = [positions[i], positions[i + 1], positions[i + 2]];
        finitePosition(...p, 'material samples');
        points.push({ p, id: i / 3, movable: measured.movable(...p) });
    }
    const build = (items, depth = 0) => {
        if (!items.length) return null;
        const axis = depth % 3;
        items.sort((a, b) => a.p[axis] - b.p[axis] || a.id - b.id);
        const middle = items.length >> 1;
        return { ...items[middle], axis, left: build(items.slice(0, middle), depth + 1),
            right: build(items.slice(middle + 1), depth + 1) };
    };
    const root = build(points);
    const movable = (x, y, z) => {
        finitePosition(x, y, z, 'query');
        const q = [x, y, z];
        let best = Infinity, nearest = null;
        const visit = node => {
            if (!node) return;
            const d = Math.hypot(node.p[0] - x, node.p[1] - y, node.p[2] - z);
            if (d < best || (d === best && (!nearest || node.id < nearest.id))) {
                best = d; nearest = node;
            }
            const delta = q[node.axis] - node.p[node.axis];
            visit(delta < 0 ? node.left : node.right);
            if (Math.abs(delta) <= best) visit(delta < 0 ? node.right : node.left);
        };
        visit(root);
        return nearest?.movable ?? false;
    };
    return { movable, staticRegion: (x, y, z) => !movable(x, y, z) };
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
