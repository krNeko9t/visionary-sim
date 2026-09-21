import {
    Color,
    Entity,
    Mesh,
    MeshInstance,
    PRIMITIVE_LINES,
    SEMANTIC_POSITION,
    ShaderMaterial
} from 'playcanvas';

/**
 * Line segments carried by a field, each group in its own tint.
 *
 * What the segments outline and what the groups mean is whoever handed them
 * over's business; this only draws segments between rest points and moves
 * them through the same deformation channel as every other geometry. The
 * proxy's wireframe comes through here, and that is not tidiness: it is the
 * picture people trust when the render looks wrong, and it is only worth
 * trusting if it is looking at the same data through the same binding.
 *
 * Each vertex is pulled a fraction of the way along its offset before it is
 * handed to the field. Offsets point inwards, so the pulled point is asked of
 * the field strictly inside what it covers rather than on its edge, and
 * neighbouring groups' lines do not draw over each other.
 *
 * Declared here rather than imported, like the other geometries `render/`
 * takes, so that this directory depends on nothing but the deformation channel.
 *
 * @typedef {object} RestLines
 * @property {Float32Array} positions - Vertex rest positions, 3 floats each.
 * @property {Float32Array} offsets - Per vertex, a rest-space vector to pull it
 *   along, 3 floats each.
 * @property {Uint32Array} indices - Segments, two vertex indices each.
 * @property {{ start: number, count: number }[]} groups - Ranges of `indices`
 *   to tint apart.
 */

/**
 * Evenly spaced hues around the colour circle, one per group, so groups that
 * sit next to each other are told apart at a glance.
 *
 * @param {number} index - Which group.
 * @param {number} count - How many there are.
 * @returns {Color} Its tint.
 */
function groupTint(index, count) {
    const hue = (index / count) * 6;
    const sector = Math.floor(hue) % 6;
    const f = hue - Math.floor(hue);
    const ramp = [
        [1, f, 0], [1 - f, 1, 0], [0, 1, f],
        [0, 1 - f, 1], [f, 0, 1], [1, 0, 1 - f]
    ][sector];
    return new Color(ramp[0], ramp[1], ramp[2]);
}

/**
 * Built per field rather than once, because the field brings its own sampler
 * text.
 *
 * @param {import('../deformation/bind.js').DeformationField} field - Field to read.
 * @returns {string} The vertex shader.
 */
const vertexWgsl = field => /* wgsl */ `
    ${field.shader}

    // A rest-space point; the field says where it is now.
    attribute vertex_position: vec3f;

    uniform matrix_viewProjection: mat4x4f;

    @vertex
    fn vertexMain(input: VertexInput) -> VertexOutput {
        var output: VertexOutput;
        let now = deformationAt(input.vertex_position).position;
        output.position = uniform.matrix_viewProjection * vec4f(now, 1.0);
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
 * One group's segments as a mesh of their own, holding only the vertices they
 * use, each pulled along its offset.
 *
 * @param {RestLines} lines - All the segments.
 * @param {{ start: number, count: number }} group - Which of them.
 * @param {number} pull - Fraction of each offset to move the vertex by.
 * @returns {{ positions: Float32Array, indices: Uint32Array }} Mesh streams.
 */
function buildGroupGeometry({ positions, offsets, indices }, { start, count }, pull) {
    /** @type {Map<number, number>} */
    const local = new Map();
    const groupIndices = new Uint32Array(count);
    for (let i = 0; i < count; i++) {
        const vertex = indices[start + i];
        if (!local.has(vertex)) {
            local.set(vertex, local.size);
        }
        groupIndices[i] = local.get(vertex);
    }

    const groupPositions = new Float32Array(local.size * 3);
    for (const [vertex, at] of local) {
        for (let axis = 0; axis < 3; axis++) {
            groupPositions[at * 3 + axis] = positions[vertex * 3 + axis] + pull * offsets[vertex * 3 + axis];
        }
    }

    return { positions: groupPositions, indices: groupIndices };
}

/**
 * @param {import('playcanvas').AppBase} app - The application.
 * @param {RestLines} lines - What to draw.
 * @param {import('../deformation/bind.js').DeformationField} field - Deformation to follow.
 * @param {object} [options] - Display options.
 * @param {string} [options.name] - What to call the entity.
 * @param {number} [options.shrink] - How much of each offset to leave undone: 1
 *   draws the segments where they are, smaller pulls every vertex further along.
 * @returns {Entity} An entity holding one mesh instance per group.
 */
export function createLineView(app, lines, field, { name = 'lines', shrink = 0.78 } = {}) {
    const device = app.graphicsDevice;
    const entity = new Entity(`line-view-${name}`);
    const instances = [];
    const { groups } = lines;

    for (let group = 0; group < groups.length; group++) {
        if (groups[group].count === 0) {
            continue;
        }

        const { positions, indices } = buildGroupGeometry(lines, groups[group], 1 - shrink);

        const material = new ShaderMaterial({
            uniqueName: 'line-view',
            vertexWGSL: vertexWgsl(field),
            fragmentWGSL: FRAGMENT_WGSL,
            attributes: {
                vertex_position: SEMANTIC_POSITION
            }
        });
        const tint = groupTint(group, groups.length);
        material.setParameter('uTint', [tint.r, tint.g, tint.b]);
        for (const [parameter, value] of Object.entries(field.parameters)) {
            material.setParameter(parameter, value);
        }
        material.update();

        const mesh = new Mesh(device);
        mesh.setPositions(positions);
        mesh.setIndices(indices);
        mesh.update(PRIMITIVE_LINES);

        const instance = new MeshInstance(mesh, material, entity);
        // The shader moves every vertex, so the CPU-side bounds are only ever
        // the rest pose and cannot be used for culling.
        instance.cull = false;
        instances.push(instance);
    }

    entity.addComponent('render', { meshInstances: instances, castShadows: false });
    return entity;
}
