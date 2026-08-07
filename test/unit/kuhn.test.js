import { describe, expect, it } from 'vitest';

import { KUHN_TETS, KUHN_TET_VOLUME_FRACTION, kuhnRestShapeInverses, kuhnRestShapes } from '../../src/sim/discretize/kuhn.js';
import { CUBE_CORNERS } from '../../src/deformation/corners.js';
import { mat3Determinant, mat3Multiply } from '../../src/sim/discretize/mat3.js';
import { cellNodeIndices } from '../../src/sim/discretize/lattice.js';

/**
 * @param {ArrayLike<number>} m - Column-major 3x3.
 * @returns {number} Signed volume of the tetrahedron spanned by its columns.
 */
const signedVolume = m => mat3Determinant(m) / 6;

describe('Kuhn decomposition', () => {
    it('splits the cube into six positively oriented tetrahedra', () => {
        const h = 0.037;
        const shapes = kuhnRestShapes(h);

        expect(shapes).toHaveLength(6);
        for (const shape of shapes) {
            // Orientation matters: the solver reads the sign of det(F) to tell
            // compression from inversion, which is meaningless if the rest
            // element is already inverted.
            // Matrices are stored as Float32Array, so compare relatively.
            expect(signedVolume(shape)).toBeGreaterThan(0);
            const expected = KUHN_TET_VOLUME_FRACTION * h ** 3;
            expect(Math.abs(signedVolume(shape) / expected - 1)).toBeLessThan(1e-6);
        }
    });

    it('exactly fills the cell volume', () => {
        const h = 0.037;
        const total = kuhnRestShapes(h).reduce((sum, m) => sum + signedVolume(m), 0);
        expect(Math.abs(total / h ** 3 - 1)).toBeLessThan(1e-6);
    });

    it('inverts the rest shape matrices', () => {
        const h = 0.02;
        const shapes = kuhnRestShapes(h);
        const inverses = kuhnRestShapeInverses(h);

        for (let t = 0; t < 6; t++) {
            const identity = mat3Multiply(shapes[t], inverses[t]);
            for (let col = 0; col < 3; col++) {
                for (let row = 0; row < 3; row++) {
                    expect(identity[col * 3 + row]).toBeCloseTo(col === row ? 1 : 0, 6);
                }
            }
        }
    });

    it('uses every cube corner', () => {
        const used = new Set(KUHN_TETS.flat());
        expect(used.size).toBe(8);
        expect(CUBE_CORNERS).toHaveLength(8);
    });

    it('conforms across cells: every interior face is shared by exactly two tetrahedra', () => {
        // The whole scheme depends on this. A non-conforming decomposition
        // would leave neighbouring cells connected only at nodes, and the
        // material would tear along cell boundaries under load.
        const cells = [3, 3, 3];
        const nodeDims = [cells[0] + 1, cells[1] + 1, cells[2] + 1];

        /** @type {Map<string, number>} */
        const faceCounts = new Map();
        const corners = new Uint32Array(8);

        for (let k = 0; k < cells[2]; k++) {
            for (let j = 0; j < cells[1]; j++) {
                for (let i = 0; i < cells[0]; i++) {
                    cellNodeIndices(nodeDims, i, j, k, corners);
                    for (const tet of KUHN_TETS) {
                        const nodes = tet.map(c => corners[c]);
                        for (let skip = 0; skip < 4; skip++) {
                            const key = nodes.filter((_, index) => index !== skip).sort((a, b) => a - b).join(',');
                            faceCounts.set(key, (faceCounts.get(key) ?? 0) + 1);
                        }
                    }
                }
            }
        }

        const boundaryFaces = [...faceCounts.values()].filter(n => n === 1).length;
        const interiorFaces = [...faceCounts.values()].filter(n => n === 2).length;

        expect(boundaryFaces + interiorFaces).toBe(faceCounts.size);
        // Six sides of a 3x3x3 block, nine squares each, two triangles apiece.
        expect(boundaryFaces).toBe(6 * 9 * 2);
    });
});
