import { describe, expect, it } from 'vitest';

import { box, sphere } from '../../src/assets/shapes.js';
import { buildLattice, cellNodeIndices } from '../../src/sim/discretize/lattice/lattice.js';
import {
    evaluateDeformationGradient,
    evaluatePosition,
    locate,
    trilinearGradients,
    trilinearWeights
} from '../../src/sim/discretize/lattice/sample.js';
import { VoxelLattice } from '../../src/sim/discretize/lattice/voxelLattice.js';
import { voxelizeSdf } from '../../src/sim/discretize/lattice/voxelize.js';

/**
 * What every discretisation has to give the rest of the simulation, checked
 * against each implementation there is.
 *
 * The entries and invariants are the ones written on the `ProxyGeometry`
 * typedef in `src/sim/discretize/proxyGeometry.js`. This file is the other half
 * of that list: the typedef says what a caller may rely on, and this is what
 * makes it true. A second implementation gets in by being added to
 * {@link IMPLEMENTATIONS} and passing, not by being reviewed against prose.
 *
 * Every check here reads only the interface. None of them knows what a given
 * implementation's nodes are arranged in, which is why the same checks can be
 * run over all of them.
 */

const DENSITY = 1000;

/**
 * What a field's `deformationAt` computes, run on the CPU.
 *
 * @callback Sampler
 * @param {import('../../src/deformation/bind.js').DeformationField} field - A field
 *   the implementation handed out.
 * @param {Float32Array} nodePositions - The array behind the buffer handle the
 *   field was made from, vec4 per node.
 * @param {number[]} rest - A rest point.
 * @returns {{ position: number[], gradient: Float32Array }} The deformed position
 *   and the column-major deformation gradient there.
 */

/**
 * The lattice's shader, run through its CPU reference (`sample.js`).
 *
 * This is the one place in the file that reads a field's parameters, and it is
 * allowed to because it is not a caller: it is this implementation's own twin of
 * its shader text, standing in for a GPU the tests do not have.
 *
 * @type {Sampler}
 */
function sampleLattice({ parameters }, nodePositions, rest) {
    const { deformOrigin: origin, deformH: h, deformCellDims: cellDims, deformNodeDims: nodeDims } = parameters;
    const { cell, local } = locate({ origin, h, cellDims }, rest[0], rest[1], rest[2]);
    const corners = cellNodeIndices(nodeDims, cell[0], cell[1], cell[2]);

    // Only the eight corners are read, so only they are copied out of the vec4
    // buffer into the 3-float layout the reference takes.
    const xyz = new Float32Array(8 * 3);
    for (let c = 0; c < 8; c++) {
        const node = parameters.deformNodeOffset + corners[c];
        xyz.set(nodePositions.subarray(node * 4, node * 4 + 3), c * 3);
    }
    const identity = [0, 1, 2, 3, 4, 5, 6, 7];
    return {
        position: evaluatePosition(xyz, identity, trilinearWeights(local)),
        gradient: evaluateDeformationGradient(xyz, identity, trilinearGradients(local, h))
    };
}

/**
 * Each implementation, as a way to make a proxy of a shape and a way to run the
 * shader its fields carry.
 *
 * @type {Record<string, {
 *   make: (shape: object) => import('../../src/sim/discretize/proxyGeometry.js').ProxyGeometry,
 *   sample: Sampler
 * }>}
 */
const IMPLEMENTATIONS = {
    VoxelLattice: {
        make: shape => new VoxelLattice(buildLattice(voxelizeSdf(shape, { resolution: 6 }), { density: DENSITY })),
        sample: sampleLattice
    }
};

/** Small shapes: the nearest-neighbour checks below are brute force. */
const SHAPES = {
    sphere: () => sphere({ radius: 0.05 }),
    box: () => box({ halfExtents: [0.04, 0.02, 0.03] })
};

/** Relative slack for comparing lengths that went through f32. */
const EPSILON = 1e-5;

/**
 * @param {Float32Array} positions - 3 floats per point.
 * @param {number} index - Which point.
 * @returns {number[]} That point.
 */
const pointAt = (positions, index) => [0, 1, 2].map(axis => positions[index * 3 + axis]);

/**
 * @param {number[]} a - A point.
 * @param {number[]} b - Another.
 * @returns {number} Distance between them.
 */
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * For every wireframe vertex, the node it sits on (I4), or -1 if none.
 *
 * Exact comparison on purpose: I4 says the vertex *is* the node's rest
 * position, not somewhere near it.
 *
 * @param {import('../../src/sim/discretize/proxyGeometry.js').ProxyGeometry} proxy - The proxy.
 * @returns {Int32Array} Node index per vertex.
 */
function vertexNodes(proxy) {
    const { restPositions, nodeCount } = proxy.dof;
    const byPosition = new Map();
    for (let n = 0; n < nodeCount; n++) {
        byPosition.set(pointAt(restPositions, n).join(','), n);
    }
    const { positions } = proxy.wireframe();
    return Int32Array.from({ length: positions.length / 3 }, (_, v) =>
        byPosition.get(pointAt(positions, v).join(',')) ?? -1);
}

/**
 * @param {import('../../src/sim/discretize/proxyGeometry.js').ProxyGeometry} proxy - The proxy.
 * @returns {number[]} Indices of the nodes that hold material (I1).
 */
function materialNodes(proxy) {
    const { invMass, nodeCount } = proxy.dof;
    return Array.from({ length: nodeCount }, (_, n) => n).filter(n => invMass[n] > 0);
}

for (const [implementation, { make, sample }] of Object.entries(IMPLEMENTATIONS)) {
    for (const [shapeName, shape] of Object.entries(SHAPES)) {
        describe(`${implementation} of a ${shapeName} as a ProxyGeometry`, () => {
            const proxy = make(shape());

            it('hands over its degrees of freedom in the shape Particles takes (entry 1)', () => {
                const { restPositions, invMass, nodeCount } = proxy.dof;
                expect(restPositions).toBeInstanceOf(Float32Array);
                expect(invMass).toBeInstanceOf(Float32Array);
                expect(Number.isInteger(nodeCount) && nodeCount > 0).toBe(true);
                expect(restPositions.length).toBe(nodeCount * 3);
                expect(invMass.length).toBe(nodeCount);
                expect(restPositions.every(Number.isFinite)).toBe(true);
                expect(invMass.every(w => Number.isFinite(w) && w >= 0)).toBe(true);
                expect(materialNodes(proxy).length).toBeGreaterThan(0);
            });

            it('uses no node without material for anything (I1)', () => {
                // A zero inverse mass means no material and nothing else, so no
                // part of the proxy that stands for material may rest on one.
                const { invMass } = proxy.dof;
                for (const node of proxy.contactSurface().nodes) {
                    expect(invMass[node], `contact node ${node}`).toBeGreaterThan(0);
                }
                for (const node of vertexNodes(proxy)) {
                    expect(invMass[node], `wireframe node ${node}`).toBeGreaterThan(0);
                }
            });

            it('names its contact surface by body-local node and gives each a radius (entry 2, I6)', () => {
                const { nodes, radii } = proxy.contactSurface();
                expect(nodes).toBeInstanceOf(Uint32Array);
                expect(radii).toBeInstanceOf(Float32Array);
                expect(nodes.length).toBeGreaterThan(0);
                expect(radii.length).toBe(nodes.length);
                for (let s = 0; s < nodes.length; s++) {
                    expect(nodes[s]).toBeLessThan(proxy.dof.nodeCount);
                    if (s > 0) {
                        expect(nodes[s]).toBeGreaterThan(nodes[s - 1]);
                    }
                    expect(radii[s] > 0 && Number.isFinite(radii[s])).toBe(true);
                }
            });

            it('draws segments between its own vertices, in groups that cover them once (entry 4)', () => {
                const { positions, offsets, indices, groups } = proxy.wireframe();
                const vertexCount = positions.length / 3;
                expect(positions).toBeInstanceOf(Float32Array);
                expect(offsets).toBeInstanceOf(Float32Array);
                expect(indices).toBeInstanceOf(Uint32Array);
                expect(Number.isInteger(vertexCount) && vertexCount > 0).toBe(true);
                expect(offsets.length).toBe(positions.length);
                expect(offsets.every(Number.isFinite)).toBe(true);
                expect(indices.length % 2).toBe(0);
                expect(indices.every(v => v < vertexCount)).toBe(true);

                let covered = 0;
                for (const { start, count } of groups) {
                    expect(start).toBe(covered);
                    expect(count % 2).toBe(0);
                    covered += count;
                }
                expect(covered).toBe(indices.length);
            });

            it('puts every wireframe vertex on a node\'s rest position (I4, I6)', () => {
                const missing = [...vertexNodes(proxy)].filter(node => node < 0);
                expect(missing.length).toBe(0);
            });

            it('seals its contact surface along every wireframe segment (I2)', () => {
                // The sphere contact model's admission condition: two contact
                // spheres whose centres are joined by a segment of the proxy
                // must touch, or another body's node passes between them.
                const { nodes, radii } = proxy.contactSurface();
                const radiusOf = new Map([...nodes].map((node, s) => [node, radii[s]]));
                const onVertex = vertexNodes(proxy);
                const { indices } = proxy.wireframe();
                const { restPositions } = proxy.dof;

                let checked = 0;
                for (let i = 0; i < indices.length; i += 2) {
                    const a = onVertex[indices[i]];
                    const b = onVertex[indices[i + 1]];
                    if (!radiusOf.has(a) || !radiusOf.has(b)) {
                        continue;
                    }
                    const gap = distance(pointAt(restPositions, a), pointAt(restPositions, b));
                    const reach = radiusOf.get(a) + radiusOf.get(b);
                    expect(gap, `nodes ${a} and ${b}`).toBeLessThanOrEqual(reach * (1 + EPSILON));
                    checked++;
                }
                // A surface with no segment between two of its nodes would pass
                // this vacuously.
                expect(checked).toBeGreaterThan(0);
            });

            it('reports a node spacing that its nodes actually have (entry 6, I3)', () => {
                // Measured by brute force, so it does not share a single
                // assumption with however the implementation arrived at it.
                const { min, max } = proxy.spacing;
                expect(min > 0 && min <= max && Number.isFinite(max)).toBe(true);

                const { restPositions } = proxy.dof;
                const nodes = materialNodes(proxy);
                let closest = Infinity;
                let loneliest = 0;
                for (const a of nodes) {
                    let nearest = Infinity;
                    for (const b of nodes) {
                        if (a !== b) {
                            nearest = Math.min(nearest, distance(pointAt(restPositions, a), pointAt(restPositions, b)));
                        }
                    }
                    closest = Math.min(closest, nearest);
                    loneliest = Math.max(loneliest, nearest);
                }
                expect(closest).toBeGreaterThanOrEqual(min * (1 - EPSILON));
                expect(loneliest).toBeLessThanOrEqual(max * (1 + EPSILON));
            });

            it('declares the contract function in the shader its field carries (entry 3, I5)', () => {
                const field = proxy.field({}, 0);
                expect(typeof field.shader).toBe('string');
                expect(field.shader).toMatch(/fn\s+deformationAt\s*\(\s*\w+\s*:\s*vec3f\s*\)\s*->\s*Deformation\b/);
                expect(typeof field.parameters).toBe('object');
            });

            it('carries a known affine motion exactly at its rest nodes (entry 3, I5, I6)', () => {
                // Any interpolation worth the name reproduces an affine map, so
                // this pins the one thing every implementation must agree on
                // without saying how it interpolates. The body sits at a
                // non-zero offset in a larger buffer, as it does in a scene.
                const A = [[1.2, 0.3, -0.1], [-0.2, 0.9, 0.4], [0.05, -0.3, 1.1]];
                const b = [0.4, -0.7, 0.25];
                const moved = p => [0, 1, 2].map(row => A[row][0] * p[0] + A[row][1] * p[1] + A[row][2] * p[2] + b[row]);

                const { restPositions, nodeCount } = proxy.dof;
                const offset = 5;
                const buffer = new Float32Array((offset + nodeCount + 3) * 4).fill(Number.NaN);
                for (let n = 0; n < nodeCount; n++) {
                    buffer.set([...moved(pointAt(restPositions, n)), 0], (offset + n) * 4);
                }

                const field = proxy.field(buffer, offset);
                for (const node of materialNodes(proxy)) {
                    const rest = pointAt(restPositions, node);
                    const { position, gradient } = sample(field, buffer, rest);
                    const expected = moved(rest);
                    for (let axis = 0; axis < 3; axis++) {
                        expect(position[axis], `node ${node} axis ${axis}`).toBeCloseTo(expected[axis], 5);
                    }
                    for (let col = 0; col < 3; col++) {
                        for (let row = 0; row < 3; row++) {
                            expect(gradient[col * 3 + row], `node ${node} F[${row}][${col}]`).toBeCloseTo(A[row][col], 4);
                        }
                    }
                }
            });

            it('reports its scale as a count and the word for what was counted (entry 5)', () => {
                const { label, value } = proxy.scale();
                expect(typeof label).toBe('string');
                expect(label.length).toBeGreaterThan(0);
                expect(Number.isInteger(value) && value > 0).toBe(true);
            });

            it('gives a stability length (entry 7)', () => {
                expect(proxy.cflLength > 0 && Number.isFinite(proxy.cflLength)).toBe(true);
            });

            it('rescales its own inverse masses in place when the density changes (entry 8, I1)', () => {
                const fresh = make(shape());
                const { invMass } = fresh.dof;
                const before = Float32Array.from(invMass);

                fresh.setDensity(DENSITY, DENSITY * 4);

                // The same array: `Particles` re-reads it after a density change.
                expect(fresh.dof.invMass).toBe(invMass);
                for (let n = 0; n < before.length; n++) {
                    if (before[n] === 0) {
                        expect(invMass[n], `node ${n} gained material`).toBe(0);
                    } else {
                        expect(invMass[n]).toBeCloseTo(before[n] / 4, 6);
                    }
                }
            });
        });
    }
}
