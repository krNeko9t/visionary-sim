/**
 * Turning a line through the scene back into one degree of freedom.
 *
 * Grabbing is the one place where the outside world points at the simulation
 * and has to be told what it hit. There is no surface to intersect here: the
 * render geometry is somebody else's, and what the solver can actually be told
 * to move is a node. So the answer is the node the line passes closest to,
 * which is also the honest answer -- it is the thing that will move.
 *
 * Pure arithmetic over an array of positions, deliberately: it is the part of
 * picking that can be checked without a GPU or a pointer.
 */

/**
 * Grabbing follows material and static ownership, never the composed GPU mass:
 * a node already held kinematically remains eligible for a new grab.
 * @param {Float32Array} invMass - Material inverse masses.
 * @param {number} node - Global node index.
 * @param {Set<number>} [staticPrescribed] - Body-owned static nodes.
 * @returns {boolean} Whether the node can be held.
 */
export function isGrabbableNode(invMass, node, staticPrescribed) {
    return invMass[node] > 0 && !staticPrescribed?.has(node);
}

/**
 * The nearest grabbable node the ray passes within `radius` of.
 *
 * Nearest along the ray rather than nearest to it, so clicking a body in front
 * of another grabs the one in front instead of whichever happens to be closer
 * to the exact line.
 *
 * @param {Float32Array} nodes - Node positions, 4 floats per node.
 * @param {Float32Array} invMass - Per-node inverse mass; zero means no material.
 * @param {number[]} origin - Ray origin.
 * @param {number[]} direction - Unit ray direction.
 * @param {number} radius - How far off the ray a node may be and still count.
 * @param {Set<number>} [staticPrescribed] - Global static node indices.
 * @returns {number} Node index, or -1 if the ray missed everything.
 */
export function nearestNodeToRay(nodes, invMass, origin, direction, radius, staticPrescribed) {
    const radiusSquared = radius * radius;
    let best = -1;
    let bestDepth = Infinity;

    for (let n = 0; n < invMass.length; n++) {
        if (!isGrabbableNode(invMass, n, staticPrescribed)) {
            continue;
        }

        const dx = nodes[n * 4] - origin[0];
        const dy = nodes[n * 4 + 1] - origin[1];
        const dz = nodes[n * 4 + 2] - origin[2];
        const depth = dx * direction[0] + dy * direction[1] + dz * direction[2];
        if (depth <= 0 || depth >= bestDepth) {
            continue;
        }

        const offAxis = dx * dx + dy * dy + dz * dz - depth * depth;
        if (offAxis > radiusSquared) {
            continue;
        }

        best = n;
        bestDepth = depth;
    }
    return best;
}

/**
 * Which body owns a node, given where each body's nodes start.
 *
 * @param {number[]} nodeOffsets - Start of each body's range, ascending.
 * @param {number} node - Node index in the shared arrays.
 * @returns {number} Body index.
 */
export function bodyOfNode(nodeOffsets, node) {
    let body = 0;
    while (body + 1 < nodeOffsets.length && node >= nodeOffsets[body + 1]) {
        body++;
    }
    return body;
}
