/**
 * Samples an object's static region on its proxy's rest positions. The result
 * belongs to this discretisation only; rebuilding must sample the region anew.
 *
 * @param {Float32Array} restPositions - World-space xyz triples.
 * @param {((x: number, y: number, z: number) => boolean)|null} [region] - Body declaration.
 * @returns {number[]} Local static node indices, including any inactive nodes.
 */
export function staticNodesInRegion(restPositions, region = null) {
    const nodes = [];
    if (region === null) {
        return nodes;
    }
    for (let n = 0; n < restPositions.length / 3; n++) {
        if (region(restPositions[n * 3], restPositions[n * 3 + 1], restPositions[n * 3 + 2])) {
            nodes.push(n);
        }
    }
    return nodes;
}
