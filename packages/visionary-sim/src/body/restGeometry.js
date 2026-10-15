/**
 * Prepared geometry in the common simulation world, in metres. These data
 * shapes carry no file format, placement, drawing payload or asset report.
 *
 * @typedef {object} TriangleMesh
 * @property {Float32Array} positions - World vertices, xyz per vertex.
 * @property {Uint32Array} indices - Three vertex indices per triangle.
 *
 * @typedef {object} Shape
 * @property {(x: number, y: number, z: number) => number} sdf - Signed distance, negative inside.
 * @property {{ min: number[], max: number[] }} bounds - World bounds.
 *
 * @typedef {object} GaussianCloud
 * @property {number} count - Number of Gaussians.
 * @property {Float32Array} positions - World centres, xyz per Gaussian.
 * @property {Float32Array} rotations - Unit quaternions, xyzw per Gaussian.
 * @property {Float32Array} scales - Standard deviations in metres, xyz per Gaussian.
 * @property {Float32Array} opacity - Coverage in [0, 1], one per Gaussian.
 *
 * @typedef {{ kind: 'mesh', mesh: TriangleMesh }
 *         | { kind: 'shape', shape: Shape }
 *         | { kind: 'cloud', cloud: GaussianCloud }} RestGeometry
 */

/**
 * @param {Float32Array} positions - Vertex positions, 3 floats per vertex.
 * @returns {{ min: number[], max: number[] }} Axis-aligned bounds.
 */
export function meshBounds(positions) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) {
        for (let axis = 0; axis < 3; axis++) {
            const v = positions[i + axis];
            if (v < min[axis]) min[axis] = v;
            if (v > max[axis]) max[axis] = v;
        }
    }
    return { min, max };
}

