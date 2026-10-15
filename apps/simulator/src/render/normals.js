/**
 * Rest-pose normals of a triangle surface.
 *
 * The deformation gradient can only rotate and shear a normal that already
 * exists, so every surface needs one set of them in its rest pose. They are
 * computed rather than loaded: an OBJ may not carry normals, a tessellated
 * shape has no file to carry them in, and both would then disagree with the
 * positions the simulation is actually driving.
 *
 * Vertices shared between triangles come out smooth and vertices duplicated at
 * an edge come out flat, which is the whole of the shading control available
 * here -- a surface that wants a crease duplicates its vertices along it.
 */

/**
 * @param {Float32Array} positions - Vertex positions, 3 floats per vertex.
 * @param {Uint32Array} indices - Triangle indices, 3 per triangle.
 * @returns {Float32Array} Unit normals, 3 floats per vertex.
 */
export function restNormals(positions, indices) {
    const normals = new Float32Array(positions.length);

    for (let t = 0; t < indices.length; t += 3) {
        const a = indices[t] * 3;
        const b = indices[t + 1] * 3;
        const c = indices[t + 2] * 3;

        const abx = positions[b] - positions[a];
        const aby = positions[b + 1] - positions[a + 1];
        const abz = positions[b + 2] - positions[a + 2];
        const acx = positions[c] - positions[a];
        const acy = positions[c + 1] - positions[a + 1];
        const acz = positions[c + 2] - positions[a + 2];

        // Left unnormalised on purpose: the cross product's length is twice the
        // triangle's area, so accumulating it weights each face by its size and
        // keeps a fan of slivers from outvoting one large neighbour.
        const nx = aby * acz - abz * acy;
        const ny = abz * acx - abx * acz;
        const nz = abx * acy - aby * acx;

        for (const base of [a, b, c]) {
            normals[base] += nx;
            normals[base + 1] += ny;
            normals[base + 2] += nz;
        }
    }

    for (let n = 0; n < normals.length; n += 3) {
        const length = Math.hypot(normals[n], normals[n + 1], normals[n + 2]);
        if (length > 0) {
            normals[n] /= length;
            normals[n + 1] /= length;
            normals[n + 2] /= length;
        }
    }
    return normals;
}
