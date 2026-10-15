/** Count material only, independently of any other prescribed ownership. */
export function materialCounts(invMass, staticPrescribed, offset = 0, count = invMass.length) {
    let materialNodes = 0;
    let staticNodes = 0;
    for (let n = offset; n < offset + count; n++) {
        if (invMass[n] > 0) {
            materialNodes++;
            if (staticPrescribed.has(n)) staticNodes++;
        }
    }
    return { materialNodes, staticNodes, movableNodes: materialNodes - staticNodes };
}
