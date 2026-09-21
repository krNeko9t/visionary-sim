import { bodyOfNode } from './pick.js';

/**
 * Turning where the ray landed into what the hand actually holds.
 *
 * `pick.js` answers "which node is under the cursor", and its tolerance is
 * legitimately a property of the discretisation -- the gap between nodes
 * really is the proxy's `spacing`, so grazing within `coarsestSpacing() * 1.2`
 * of one is the honest definition of a hit. This module answers a different
 * question, "how much material comes along once the hand closes", and that
 * answer must not be a property of the discretisation at all: a fixed number
 * of *nodes* is a fixed *volume* only at one resolution, and shrinks as the
 * cube of the spacing as the proxy gets finer. That is the whole reported
 * complaint -- dragging feels heavier the denser the nodes -- so severing
 * "how big is the hand" from "how fine is the mesh" is the one thing this
 * file exists to do. The hand's size is a radius in metres,
 * not a node count.
 *
 * Two strategies, chosen at runtime like `KinematicDrive`'s two drive laws:
 *
 *   - `singleNode` holds exactly the node the ray hit. It is the strategy
 *     the reported complaint describes.
 *   - `withinRadius` holds every movable node of the *same body* within a
 *     fixed world-space radius of that node. A ball, not a geodesic
 *     neighbourhood: reaching for which nodes are joined to which would mean
 *     this module learning how the body was cut up, which is `sim/discretize`
 *     knowledge and would break the reason it is a separate file. The accepted
 *     cost is that a grab near a thin feature can still bridge two lobes of
 *     the same body across open air -- fixing that needs the mesh, not just
 *     positions.
 *
 * Pure arithmetic over the same `Float32Array` shapes `pick.js` reads, so it
 * can be checked without a GPU or a `Particles` instance.
 */

/**
 * @typedef {object} Grip
 * @property {number[]} nodes - Global node indices to hold, nearest the
 *   anchor first. `nodes[0]` is always the anchor node itself.
 * @property {number[][]} offsets - Each node's offset from the anchor,
 *   `[x, y, z]`, same order as `nodes` -- exactly the shape
 *   {@link import('./constraints/kinematicDrive.js').KinematicDrive#hold} takes.
 * @property {number} found - How many nodes were inside the hand before
 *   `limit` truncated it. Equal to `nodes.length` unless the cap bit.
 */

/**
 * Holds just the node the ray hit. The strategy that does not consult a
 * radius at all -- `options` is accepted only so both strategies share one
 * call shape and can sit in the same lookup table.
 *
 * @param {Float32Array} positions - Node positions, 4 floats per node.
 * @param {Float32Array} invMass - Per-node inverse mass; unused here, kept
 *   for signature parity with {@link withinRadius}.
 * @param {number} anchor - Global index of the node the ray hit.
 * @param {object} [options] - Ignored.
 * @returns {Grip} One node, zero offset.
 */
export function singleNode(positions, invMass, anchor, options) {
    return { nodes: [anchor], offsets: [[0, 0, 0]], found: 1 };
}

/**
 * Holds every movable node of the anchor's own body within `radius` metres
 * of it, nearest first.
 *
 * Restricted to one body rather than scanning every node: under the hard
 * drive law a straddled node on another body would take on zero inverse mass
 * and translate rigidly with the hand, welding two bodies that otherwise
 * only relate to each other through `BodyContact`. It would also make
 * whether the ball crosses into a neighbour depend on the resting gap
 * between them, which docs/adr/0008 records as about one node spacing --
 * a resolution quantity. Letting the ball cross it would smuggle
 * resolution dependence back in through the one door this module exists to
 * close.
 *
 * Nodes with `invMass === 0` are excluded, the same rule `pick.js` applies:
 * a node with no material never moves, so grip can never hold
 * something the aim could never have hit.
 *
 * Ties in distance are broken by node index. Not cosmetic: where nodes are
 * laid out regularly, several neighbours of a node sit at *exactly* equal
 * float distance, so without a tie-break the held set would depend on
 * `Array.prototype.sort`'s stability rather than on geometry.
 *
 * @param {Float32Array} positions - Node positions, 4 floats per node.
 * @param {Float32Array} invMass - Per-node inverse mass; zero means inactive.
 * @param {number} anchor - Global index of the node the ray hit.
 * @param {object} params
 * @param {number} params.radius - World-space radius, metres.
 * @param {number[]} params.nodeOffsets - Start of each body's node range in
 *   the shared arrays, ascending -- `Particles.offsets`.
 * @param {number} [params.limit] - Most nodes to return; the rest are still
 *   counted into `found`. Defaults to unlimited.
 * @returns {Grip} The held set, nearest-first, anchor always at index 0.
 */
export function withinRadius(positions, invMass, anchor, { radius, nodeOffsets, limit = Infinity }) {
    const ax = positions[anchor * 4];
    const ay = positions[anchor * 4 + 1];
    const az = positions[anchor * 4 + 2];
    const radiusSquared = radius * radius;

    const body = bodyOfNode(nodeOffsets, anchor);
    const start = nodeOffsets[body];
    const end = body + 1 < nodeOffsets.length ? nodeOffsets[body + 1] : invMass.length;

    const candidates = [];
    for (let n = start; n < end; n++) {
        if (n === anchor || invMass[n] === 0) {
            continue;
        }
        const dx = positions[n * 4] - ax;
        const dy = positions[n * 4 + 1] - ay;
        const dz = positions[n * 4 + 2] - az;
        const distanceSquared = dx * dx + dy * dy + dz * dz;
        if (distanceSquared <= radiusSquared) {
            candidates.push({ node: n, distanceSquared, offset: [dx, dy, dz] });
        }
    }
    candidates.sort((a, b) => a.distanceSquared - b.distanceSquared || a.node - b.node);

    const found = candidates.length + 1;
    const kept = candidates.slice(0, Math.max(0, limit - 1));

    return {
        nodes: [anchor, ...kept.map(c => c.node)],
        offsets: [[0, 0, 0], ...kept.map(c => c.offset)],
        found
    };
}

/** Strategies a grab can use to turn an anchor node into a held set. */
export const GRIPS = { singleNode, withinRadius };

/**
 * Default hand radius, metres, bounded on both sides by facts about this
 * project's scenes rather than by any constant of the discretisation:
 *
 *   - Floor: it must exceed the coarsest node spacing in the repo (the wolf,
 *     about 0.02 m), or on that body the ball would contain only the
 *     anchor and this would silently degrade to `singleNode`.
 *   - Ceiling: its diameter must stay well under a body's own extent
 *     (bodies run 0.15-0.24 m), or a grab stops being a handful and becomes
 *     a body-hold.
 *
 * Deliberately not a multiple of any node spacing -- that coupling is exactly
 * what this milestone removes. No lower clamp to `coarsestSpacing()` either: a
 * one-sided hedge would blur the claim that the hand's size is resolution
 * independent.
 */
export const DEFAULT_GRAB_RADIUS = 0.03;

/**
 * Deterministic upper bound on how many nodes a `radius`-ball can contain on a
 * body whose nodes are never closer than `spacing`, used to warn before a hold
 * might need truncating.
 *
 * Not a probabilistic guess, and it asks nothing about how the nodes are
 * arranged: balls of radius `spacing / 2` around them cannot overlap, and every
 * one whose centre is in the hand fits inside a ball of radius
 * `radius + spacing / 2`. Dividing the two ball volumes bounds the count. It is
 * looser than a bound argued from one particular arrangement would be -- a grid
 * of the same spacing stays well under it -- and that is the price of it
 * holding for any arrangement. Keep an eye on the margin: at the
 * slider's largest hand on the finest body in the repo it comes to about 3650
 * against a capacity of 4096, and a warning that fires on scenes that are
 * actually fine would be a useless one.
 *
 * @param {number} radius - Hand radius, metres.
 * @param {number} spacing - Smallest distance between two nodes of the body,
 *   metres: a proxy's measured `spacing.min`.
 * @returns {number} Upper bound on nodes the ball can contain.
 */
export function worstCaseHeldNodes(radius, spacing) {
    return Math.floor(((2 * radius) / spacing + 1) ** 3);
}
