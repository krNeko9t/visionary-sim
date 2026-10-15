import { meshBounds } from 'visionary-sim/body/restGeometry.js';

export { meshBounds };

/**
 * Minimal OBJ parser: positions and triangulated faces only.
 *
 * Normals and texture coordinates are deliberately dropped. The renderer
 * recomputes normals from the deformation gradient every frame, and the
 * simulation only ever sees positions, so anything else in the file is dead
 * weight.
 */

/**
 * @typedef {import('visionary-sim/body/restGeometry.js').TriangleMesh} TriangleMesh
 */

/**
 * @param {string} text - Contents of an OBJ file.
 * @returns {TriangleMesh} The parsed mesh.
 */
export function parseObj(text) {
    const positions = [];
    const indices = [];
    /** Reused across faces to avoid allocating per line. */
    const face = [];

    for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();
        if (line.length === 0 || line.charCodeAt(0) === 35 /* # */) {
            continue;
        }

        if (line.startsWith('v ')) {
            const parts = line.split(/\s+/);
            positions.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
            continue;
        }

        if (!line.startsWith('f ')) {
            continue;
        }

        face.length = 0;
        const parts = line.split(/\s+/);
        const vertexCount = positions.length / 3;
        for (let i = 1; i < parts.length; i++) {
            // "v", "v/vt", "v//vn" and "v/vt/vn" all start with the position index.
            const index = parseInt(parts[i], 10);
            if (Number.isNaN(index)) {
                continue;
            }
            // OBJ is 1-based; negative indices count back from the current end.
            face.push(index > 0 ? index - 1 : vertexCount + index);
        }

        // Fan triangulation. Every mesh we ship is convex per face (quads at
        // worst), so a fan is exact.
        for (let i = 2; i < face.length; i++) {
            indices.push(face[0], face[i - 1], face[i]);
        }
    }

    return {
        positions: new Float32Array(positions),
        indices: new Uint32Array(indices)
    };
}

/**
 * @param {string} url - URL of an OBJ file.
 * @returns {Promise<TriangleMesh>} The parsed mesh.
 */
export async function loadObj(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`loadObj: ${url} -> HTTP ${response.status}`);
    }
    return parseObj(await response.text());
}

/**
 * Scales and translates a mesh in place so its bounds fit a target size and its
 * base sits at the origin. Assets come in wildly different units (Spot is ~2
 * units wide, the bunny ~0.15), and the solver's stiffness numbers are in real
 * Pascals, so geometry has to be in metres before anything else happens.
 *
 * @param {Float32Array} positions - Vertex positions, modified in place.
 * @param {number} targetSize - Desired size of the largest axis, in metres.
 * @returns {Float32Array} The same array, for chaining.
 */
export function normalizeMesh(positions, targetSize) {
    const { min, max } = meshBounds(positions);
    const extent = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    const scale = targetSize / Math.max(extent[0], extent[1], extent[2]);
    const centreX = (min[0] + max[0]) * 0.5;
    const centreZ = (min[2] + max[2]) * 0.5;

    for (let i = 0; i < positions.length; i += 3) {
        positions[i] = (positions[i] - centreX) * scale;
        positions[i + 1] = (positions[i + 1] - min[1]) * scale;
        positions[i + 2] = (positions[i + 2] - centreZ) * scale;
    }
    return positions;
}

/**
 * @param {Float32Array} positions - Vertex positions, modified in place.
 * @param {number[]} offset - Translation to apply.
 * @returns {Float32Array} The same array, for chaining.
 */
export function translateMesh(positions, offset) {
    for (let i = 0; i < positions.length; i += 3) {
        positions[i] += offset[0];
        positions[i + 1] += offset[1];
        positions[i + 2] += offset[2];
    }
    return positions;
}
