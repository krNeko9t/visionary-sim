import {
    Color,
    Entity,
    Mesh,
    MeshInstance,
    PRIMITIVE_LINES,
    SEMANTIC_ATTR13,
    SEMANTIC_POSITION,
    ShaderMaterial
} from 'playcanvas';

import { COLOR_COUNT, cellCoords, cellNodeIndices } from '../discretize/lattice.js';
import { SAMPLE_WGSL, bindDeformation } from '../../deformation/bind.js';
import { CUBE_CORNERS } from '../../deformation/corners.js';

/**
 * A picture of the solver's own insides: one shrunken wireframe cube per
 * occupied cell, tinted by its parallel-solve colour, driven live off the node
 * buffer.
 *
 * This lives under `sim/` rather than with the render paths because it is not
 * a way of drawing an object -- it draws cells, colour groups and nodes, none
 * of which the render side is allowed to know about. Anything that has to
 * mention a lattice to do its job belongs on this side of the fence.
 *
 * Showing occupancy and colouring in one picture is deliberate. Occupancy tells
 * you whether voxelisation leaked or missed a limb; the colouring is what the
 * GPU solver's correctness rests on, and eight interleaved tints make a broken
 * parity rule obvious.
 *
 * It reads the node positions through the same deformation channel as the
 * render paths, using the one accessor whose geometry already sits on the
 * lattice. That is not tidiness: this view is the picture people trust when the
 * render looks wrong, and it is only worth trusting if it is looking at the
 * same data through the same binding.
 */

/**
 * One tint per colour group, spread evenly around the hue circle. Adjacent
 * cells always differ in at least one parity bit, so evenly spaced hues make a
 * broken parity rule show up as a flat patch of one colour.
 */
const GROUP_TINTS = Array.from({ length: COLOR_COUNT }, (_, index) => {
    const hue = (index / COLOR_COUNT) * 6;
    const sector = Math.floor(hue) % 6;
    const f = hue - Math.floor(hue);
    const ramp = [
        [1, f, 0], [1 - f, 1, 0], [0, 1, f],
        [0, 1 - f, 1], [f, 0, 1], [1, 0, 1 - f]
    ][sector];
    return new Color(ramp[0], ramp[1], ramp[2]);
});

/** The 12 edges of a cube, as pairs of {@link CUBE_CORNERS} indices. */
const CUBE_EDGES = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7]
];

const VERTEX_WGSL = /* wgsl */ `
    ${SAMPLE_WGSL}

    attribute vertex_position: vec3f;
    // xyz: rest-space offset towards the cell centre. w: this body's node index.
    attribute vertex_nodeData: vec4f;

    uniform matrix_viewProjection: mat4x4f;

    @vertex
    fn vertexMain(input: VertexInput) -> VertexOutput {
        var output: VertexOutput;
        let node = deformedNode(u32(input.vertex_nodeData.w));
        output.position = uniform.matrix_viewProjection * vec4f(node + input.vertex_nodeData.xyz, 1.0);
        return output;
    }
`;

const FRAGMENT_WGSL = /* wgsl */ `
    uniform uTint: vec3f;

    @fragment
    fn fragmentMain(input: FragmentInput) -> FragmentOutput {
        var output: FragmentOutput;
        output.color = vec4f(uniform.uTint, 1.0);
        return output;
    }
`;

/**
 * @param {import('../discretize/lattice.js').Lattice} lattice - Lattice to visualise.
 * @param {{ start: number, count: number }} range - Cells of one colour.
 * @param {number} inset - How far to pull each corner towards the cell centre.
 * @returns {{ positions: Float32Array, nodeData: Float32Array, indices: Uint32Array }} Mesh streams.
 */
function buildGroupGeometry(lattice, range, inset) {
    const { cells, cellDims, nodeDims, restPositions } = lattice;
    const { start, count } = range;

    const positions = new Float32Array(count * 8 * 3);
    const nodeData = new Float32Array(count * 8 * 4);
    const indices = new Uint32Array(count * CUBE_EDGES.length * 2);
    const corners = new Uint32Array(8);
    const coord = [0, 0, 0];
    let vertex = 0;
    let index = 0;

    for (let n = 0; n < count; n++) {
        cellCoords(cellDims, cells[start + n], coord);
        cellNodeIndices(nodeDims, coord[0], coord[1], coord[2], corners);
        const base = vertex;

        for (let c = 0; c < 8; c++) {
            const node = corners[c];
            const offset = CUBE_CORNERS[c];
            for (let axis = 0; axis < 3; axis++) {
                const shift = offset[axis] ? -inset : inset;
                // Rest position keeps the mesh bounds meaningful; the shader
                // replaces it with the live node position.
                positions[vertex * 3 + axis] = restPositions[node * 3 + axis] + shift;
                nodeData[vertex * 4 + axis] = shift;
            }
            nodeData[vertex * 4 + 3] = node;
            vertex++;
        }

        for (const [a, b] of CUBE_EDGES) {
            indices[index++] = base + a;
            indices[index++] = base + b;
        }
    }

    return { positions, nodeData, indices };
}

/**
 * @param {import('playcanvas').AppBase} app - The application.
 * @param {import('../discretize/lattice.js').Lattice} lattice - Lattice to visualise.
 * @param {import('../../deformation/bind.js').DeformationField} field - Deformation to follow.
 * @param {object} [options] - Display options.
 * @param {number} [options.shrink] - Cell size as a fraction of the real cell.
 * @returns {Entity} An entity holding one mesh instance per colour group.
 */
export function createLatticeView(app, lattice, field, { shrink = 0.78 } = {}) {
    const device = app.graphicsDevice;
    const entity = new Entity('lattice-debug');
    const instances = [];
    const inset = (lattice.h * (1 - shrink)) / 2;

    for (let group = 0; group < lattice.colorRanges.length; group++) {
        const range = lattice.colorRanges[group];
        if (range.count === 0) {
            continue;
        }

        const { positions, nodeData, indices } = buildGroupGeometry(lattice, range, inset);

        const material = new ShaderMaterial({
            uniqueName: 'lattice-view',
            vertexWGSL: VERTEX_WGSL,
            fragmentWGSL: FRAGMENT_WGSL,
            attributes: {
                vertex_position: SEMANTIC_POSITION,
                vertex_nodeData: SEMANTIC_ATTR13
            }
        });
        const tint = GROUP_TINTS[group];
        material.setParameter('uTint', [tint.r, tint.g, tint.b]);
        bindDeformation(material, field);
        material.update();

        const mesh = new Mesh(device);
        mesh.setPositions(positions);
        mesh.setVertexStream(SEMANTIC_ATTR13, nodeData, 4);
        mesh.setIndices(indices);
        mesh.update(PRIMITIVE_LINES);

        const instance = new MeshInstance(mesh, material, entity);
        // Positions come from the storage buffer, so the CPU-side bounds are
        // only ever the rest pose and cannot be used for culling.
        instance.cull = false;
        instances.push(instance);
    }

    entity.addComponent('render', { meshInstances: instances, castShadows: false });
    return entity;
}
