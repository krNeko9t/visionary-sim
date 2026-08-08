/**
 * What a cloud actually is, before anyone decides how to place it.
 *
 * A capture arrives with no stated units and no stated up axis, and the two
 * cannot be recovered from the file -- so this module does not try. It measures
 * and prints, and a human reads the numbers and writes down a convention. The
 * one thing it does decide is *which* numbers: a raw min/max is not a size,
 * because a handful of floaters a hundred metres out will set it. Every extent
 * here is a quantile.
 *
 * @typedef {object} CloudBounds
 * @property {number[]} min - Lower corner.
 * @property {number[]} max - Upper corner.
 */

/** Fraction trimmed from each end of each axis before an extent is believed. */
const DEFAULT_TRIM = 0.01;

/**
 * The box holding all but the outermost `trim` of the centres on each axis.
 *
 * Per-axis rather than by distance from the centroid, because that is what a
 * lattice is laid out along, and because a capture's junk is rarely radially
 * symmetric.
 *
 * @param {import('./cloud.js').SplatCloud} cloud - The cloud.
 * @param {object} [options] - Trimming options.
 * @param {number} [options.trim] - Fraction dropped from each end, per axis.
 * @returns {CloudBounds} The trimmed bounds.
 */
export function robustBounds(cloud, { trim = DEFAULT_TRIM } = {}) {
    const min = [0, 0, 0];
    const max = [0, 0, 0];

    for (let axis = 0; axis < 3; axis++) {
        const values = axisValues(cloud, axis);
        values.sort();
        const low = Math.floor(trim * (cloud.count - 1));
        min[axis] = values[low];
        max[axis] = values[cloud.count - 1 - low];
    }
    return { min, max };
}

/**
 * @param {import('./cloud.js').SplatCloud} cloud - The cloud.
 * @returns {CloudBounds} The bounds of every centre, floaters included.
 */
export function rawBounds(cloud) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];

    for (let i = 0; i < cloud.count; i++) {
        for (let axis = 0; axis < 3; axis++) {
            const v = cloud.positions[i * 3 + axis];
            min[axis] = Math.min(min[axis], v);
            max[axis] = Math.max(max[axis], v);
        }
    }
    return { min, max };
}

/**
 * Everything worth knowing before choosing a convention and a size.
 *
 * @param {import('./cloud.js').SplatCloud} cloud - The cloud.
 * @param {object} [options] - Trimming options, see {@link robustBounds}.
 * @param {number} [options.trim] - Fraction dropped from each end, per axis.
 * @returns {object} A flat report.
 */
export function measureCloud(cloud, options = {}) {
    const raw = rawBounds(cloud);
    const robust = robustBounds(cloud, options);
    const extent = sizeOf(robust);

    return {
        count: cloud.count,
        raw,
        robust,
        extent,
        centre: robust.min.map((v, axis) => v + extent[axis] * 0.5),
        /** How much wider the untrimmed box is: the floater tax, per axis. */
        floaterRatio: sizeOf(raw).map((v, axis) => (extent[axis] > 0 ? v / extent[axis] : 1)),
        /** Half the diagonal of a Gaussian, so it compares with cell sizes. */
        splatRadius: quantiles(perSplatMax(cloud.scales, cloud.count)),
        opacity: quantiles(Float32Array.from(cloud.opacity))
    };
}

/**
 * The report as something to put in front of a person.
 *
 * @param {string} name - What was measured.
 * @param {ReturnType<typeof measureCloud>} report - The measurements.
 * @returns {string} A few lines, in file units.
 */
export function describeCloud(name, report) {
    const fixed = values => values.map(v => v.toFixed(3)).join(', ');
    const { extent, splatRadius, opacity, floaterRatio } = report;
    const axes = ['x', 'y', 'z'];
    const shortest = axes[extent.indexOf(Math.min(...extent))];

    return [
        `${name}: ${report.count} splats`,
        `  extent (1-99%)  ${fixed(extent)}  -- shortest axis is ${shortest}`,
        `  centre          ${fixed(report.centre)}`,
        `  floater tax     ${fixed(floaterRatio)}x the trimmed box`,
        `  splat radius    p50 ${splatRadius.p50.toFixed(4)}  p99 ${splatRadius.p99.toFixed(4)}`,
        `  opacity         p01 ${opacity.p01.toFixed(3)}  p50 ${opacity.p50.toFixed(3)}`
    ].join('\n');
}

/**
 * @param {CloudBounds} bounds - The box.
 * @returns {number[]} Its size along each axis.
 */
export function sizeOf({ min, max }) {
    return [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
}

/**
 * @param {import('./cloud.js').SplatCloud} cloud - The cloud.
 * @param {number} axis - 0, 1 or 2.
 * @returns {Float32Array} Every centre's coordinate along that axis.
 */
function axisValues(cloud, axis) {
    const values = new Float32Array(cloud.count);
    for (let i = 0; i < cloud.count; i++) {
        values[i] = cloud.positions[i * 3 + axis];
    }
    return values;
}

/**
 * @param {Float32Array} triples - Three values per item.
 * @param {number} count - Number of items.
 * @returns {Float32Array} The largest of each item's three values.
 */
function perSplatMax(triples, count) {
    const out = new Float32Array(count);
    for (let i = 0; i < count; i++) {
        out[i] = Math.max(triples[i * 3], triples[i * 3 + 1], triples[i * 3 + 2]);
    }
    return out;
}

/**
 * @param {Float32Array} values - Values to summarise; sorted in place.
 * @returns {{ p01: number, p50: number, p99: number }} Three quantiles.
 */
function quantiles(values) {
    values.sort();
    const at = q => values[Math.min(values.length - 1, Math.floor(q * values.length))];
    return { p01: at(0.01), p50: at(0.5), p99: at(0.99) };
}
