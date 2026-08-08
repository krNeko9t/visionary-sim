import { cleanCloud } from './clean.js';
import { describeCloud, measureCloud } from './measure.js';
import { loadCloud } from './cloud.js';
import { orientCloud, placeCloud } from './place.js';

/**
 * A scan, brought all the way in: read, cleaned, turned the right way up, sized
 * and stood where it was asked to stand.
 *
 * This exists because the order of those steps is load-bearing and easy to get
 * wrong. Cleaning has to come before measuring, because until the floaters are
 * gone the object has no size to measure -- `bread.ply` reads as 2.6 units
 * across and is 0.53. Orienting has to come before sizing, because "the longest
 * axis" is not the same axis in every frame. Doing it in one function means no
 * scene can put them in a different order.
 *
 * The report is the other half of the deal. Nothing in a 3DGS PLY says which
 * way is up or what a unit means, so both are declared by whoever places the
 * asset -- and a declaration nobody checks is a guess. The numbers come out
 * alongside the geometry so the declaration can be checked against the thing.
 *
 * @typedef {object} Capture
 * @property {string} name - What it is called.
 * @property {import('./cloud.js').SplatCloud} cloud - Standing in world space.
 * @property {string} report - What was measured, for a person to read.
 */

/**
 * @param {string} url - URL of a binary 3DGS PLY.
 * @param {object} options - The declaration.
 * @param {string} options.name - What to call it.
 * @param {string} options.convention - Source frame, a key of
 *   {@link import('./place.js').CONVENTIONS}. Not guessable from the file: the
 *   two captures in this repository disagree with each other.
 * @param {number} options.size - Size of the longest axis afterwards, in metres.
 * @param {number[]} options.position - Where its base ends up.
 * @param {number} [options.minOpacity] - Faintness below which a Gaussian is junk.
 * @returns {Promise<Capture>} The placed cloud and its measurements.
 */
export async function loadCapture(url, { name, convention, size, position, minOpacity }) {
    const asRead = await loadCloud(url);
    const cloud = cleanCloud(asRead, { minOpacity });
    orientCloud(cloud, convention);

    // Measured in file units, after cleaning and turning: this is the number
    // that says whether the capture was in metres, centimetres or nothing in
    // particular, and whether the declared convention was the right one.
    const measured = measureCloud(cloud);
    const { scale } = placeCloud(cloud, { size, position });

    const report = [
        describeCloud(`${name} as read`, measureCloud(asRead)),
        describeCloud(`${name} cleaned, read as ${convention}`, measured),
        `  placed          x${scale.toFixed(3)} -> ${size} m on the longest axis`
    ].join('\n');

    return { name, cloud, report };
}
