/**
 * Parametric surfaces as triangles.
 *
 * The analytic bodies are defined by distance functions, which the simulator
 * can build its proxy geometry from directly but the renderer has nothing to
 * draw. This turns them into geometry, and only for that: the simulation still
 * reads the distance function, so the triangles carry no authority over the
 * body's shape.
 *
 * Everything here triangulates a `(u, v)` grid, so each shape only has to say
 * where a point at `(u, v)` is. The one rule a shape must follow is that
 * `du x dv` points out of the surface, which is what makes the triangles face
 * outwards without anyone tracking winding by hand.
 */

/**
 * Triangulates a parametric patch.
 *
 * Wrapping an axis reuses the first row of vertices instead of emitting a
 * duplicate seam, so a closed surface comes out smooth rather than creased
 * where it joins. A row that is a single point -- the pole of a sphere -- is
 * likewise stored once: copies of it would each be shaded by the triangles of
 * their own column alone, leaving a dark speck exactly where the surface is
 * smoothest.
 *
 * @param {number} uSegments - Quads along u.
 * @param {number} vSegments - Quads along v.
 * @param {(u: number, v: number) => number[]} point - Surface point at `(u, v)`, both in [0, 1].
 * @param {object} [options] - Topology.
 * @param {boolean} [options.wrapU] - Whether u = 1 is the same place as u = 0.
 * @param {boolean} [options.wrapV] - Whether v = 1 is the same place as v = 0.
 * @returns {import('./objLoader.js').TriangleMesh} The patch.
 */
export function patch(uSegments, vSegments, point, { wrapU = false, wrapV = false } = {}) {
    const uCount = wrapU ? uSegments : uSegments + 1;
    const vCount = wrapV ? vSegments : vSegments + 1;

    const values = [];
    /** Which vertex each grid sample ended up as. */
    const vertexAt = new Uint32Array(uCount * vCount);

    for (let j = 0; j < vCount; j++) {
        const row = Array.from({ length: uCount }, (_, i) => point(i / uSegments, j / vSegments));
        // Exact equality on purpose: a shape that means to close a row has to
        // say so exactly, which is a demand on its arithmetic rather than a
        // tolerance nobody can choose well.
        const pinched = row.every(p => p.every((value, axis) => value === row[0][axis]));

        for (let i = 0; i < uCount; i++) {
            if (pinched && i > 0) {
                vertexAt[i + j * uCount] = vertexAt[j * uCount];
                continue;
            }
            vertexAt[i + j * uCount] = values.length / 3;
            values.push(row[i][0], row[i][1], row[i][2]);
        }
    }

    const indices = new Uint32Array(uSegments * vSegments * 6);
    let n = 0;
    for (let j = 0; j < vSegments; j++) {
        for (let i = 0; i < uSegments; i++) {
            // Modulo is the wrap: on an unwrapped axis the count is one larger
            // than the segment count, so it never triggers.
            const iNext = (i + 1) % uCount;
            const jNext = (j + 1) % vCount;
            const a = vertexAt[i + j * uCount];
            const b = vertexAt[iNext + j * uCount];
            const c = vertexAt[iNext + jNext * uCount];
            const d = vertexAt[i + jNext * uCount];
            // Quads touching a pinched row come out with two equal corners.
            // They are left in as zero-area triangles: they draw nothing, they
            // weigh nothing in the normals, and dropping them would cost a
            // second pass to compact the index buffer.
            indices[n++] = a;
            indices[n++] = b;
            indices[n++] = c;
            indices[n++] = a;
            indices[n++] = c;
            indices[n++] = d;
        }
    }

    return { positions: new Float32Array(values), indices };
}

/**
 * Joins patches into one mesh, keeping them as separate islands.
 *
 * Vertices are never merged across patches, which is how a shape gets a crease:
 * a box is six patches precisely so its edges shade sharp.
 *
 * @param {import('./objLoader.js').TriangleMesh[]} parts - Patches to join.
 * @returns {import('./objLoader.js').TriangleMesh} The combined mesh.
 */
export function joinPatches(parts) {
    const vertexCount = parts.reduce((total, part) => total + part.positions.length / 3, 0);
    const indexCount = parts.reduce((total, part) => total + part.indices.length, 0);
    const positions = new Float32Array(vertexCount * 3);
    const indices = new Uint32Array(indexCount);

    let vertex = 0;
    let index = 0;
    for (const part of parts) {
        positions.set(part.positions, vertex * 3);
        for (const value of part.indices) {
            indices[index++] = value + vertex;
        }
        vertex += part.positions.length / 3;
    }

    return { positions, indices };
}
