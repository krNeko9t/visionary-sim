import { bodyOfNode } from './pick.js';
import { limitPointToContainer } from './solver/container.js';

/**
 * Turning where the ray landed into what the hand actually holds.
 *
 * `pick.js` answers "which node is under the cursor", and its tolerance is
 * legitimately a lattice property -- the gap between nodes really is `h`, so
 * grazing within `coarsestCell() * 1.2` of one is the honest definition of a
 * hit. This module answers a different question, "how much material comes
 * along once the hand closes", and that answer must not be a lattice
 * property at all: a fixed number of *nodes* is a fixed *volume* only at one
 * resolution, and shrinks as `h^3` as the lattice gets finer. That is the
 * whole reported complaint -- dragging feels heavier the denser the lattice
 * -- so severing "how big is the hand" from "how fine is the mesh" is the
 * one thing this file exists to do. The hand's size is a radius in metres,
 * not a node count.
 *
 * Two strategies, chosen at runtime like `KinematicDrive`'s two drive laws:
 *
 *   - `singleNode` holds exactly the node the ray hit. It is the strategy
 *     the reported complaint describes.
 *   - `withinRadius` holds every movable node of the *same body* within a
 *     fixed world-space radius of that node. A ball, not a geodesic
 *     neighbourhood: reaching for cell adjacency would mean this module
 *     learning what a cell is, which is `sim/discretize` knowledge and would
 *     break the reason it is a separate file from the lattice. The accepted
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
 * between them, which ARCHITECTURE.md §四 4.2 records as "about one cell" --
 * a lattice-resolution quantity. Letting the ball cross it would smuggle
 * resolution dependence back in through the one door this module exists to
 * close.
 *
 * Nodes with `invMass === 0` are excluded, the same rule `pick.js` applies:
 * a node no occupied cell touches never moves, so grip can never hold
 * something the aim could never have hit.
 *
 * Ties in distance are broken by node index. Not cosmetic: on a regular
 * lattice the face neighbours of a node sit at *exactly* equal float
 * distance, so without a tie-break the held set would depend on
 * `Array.prototype.sort`'s stability rather than on geometry.
 *
 * @param {Float32Array} positions - Node positions, 4 floats per node.
 * @param {Float32Array} invMass - Per-node inverse mass; zero means inert.
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
 * project's scenes rather than by any lattice constant:
 *
 *   - Floor: it must exceed the coarsest cell in the repo (the wolf at
 *     0.24 m / 12 = 0.02 m), or on that body the ball would contain only the
 *     anchor and this would silently degrade to `singleNode`.
 *   - Ceiling: its diameter must stay well under a body's own extent
 *     (bodies run 0.15-0.24 m), or a grab stops being a handful and becomes
 *     a body-hold.
 *
 * Deliberately not a multiple of any `h` -- that coupling is exactly what
 * this milestone removes. No lower clamp to `coarsestCell()` either: a
 * one-sided hedge would blur the claim that the hand's size is resolution
 * independent.
 */
export const DEFAULT_GRAB_RADIUS = 0.03;

/**
 * Deterministic upper bound on how many lattice nodes a `radius`-ball can
 * contain on a lattice with spacing `h`, used to warn before a hold might
 * need truncating.
 *
 * Not a probabilistic guess: nodes on the same lattice are never closer than
 * `h`, so each owns a disjoint `h`-cube, and every such cube touching the
 * ball fits inside a ball of radius `radius + h * sqrt(3) / 2` (half the
 * cube's space diagonal). Dividing that larger ball's volume by one cube's
 * volume bounds the count. A ball, not the cube form
 * `worstCaseBucketOccupancy` uses for square buckets: the hand is a sphere,
 * and the cube's ~2x overestimate would fire this warning on scenes that are
 * actually fine, which is the one thing that would make the warning useless.
 *
 * @param {number} radius - Hand radius, metres.
 * @param {number} h - Lattice node spacing, metres.
 * @returns {number} Upper bound on nodes the ball can contain.
 */
export function worstCaseHeldNodes(radius, h) {
    const outer = radius / h + Math.sqrt(3) / 2;
    return Math.ceil((4 / 3) * Math.PI * outer ** 3);
}

/** Keeps a moving handle inside the same rigid container used by contact. */
export function limitGripTarget(position, containerFrame) {
    return limitPointToContainer(containerFrame, position);
}
