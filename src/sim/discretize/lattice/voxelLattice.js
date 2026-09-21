import { latticeField } from '../../../deformation/bind.js';
import { CUBE_CORNERS } from '../../../deformation/corners.js';
import { cellCoords, cellNodeIndices, surfaceNodes } from './lattice.js';

/**
 * A contact node's radius, as a fraction of the cell size.
 *
 * Half a cell is the smallest value that still makes a surface, and that is how
 * this lattice meets I2. The boundary nodes sit a cell apart along the edges
 * that join them, so spheres any smaller leave gaps between them along the axes
 * and another body's nodes slip through. Larger only inflates the body: contact
 * would resolve further out than the material actually reaches.
 */
const CONTACT_RADIUS_CELLS = 0.5;

/** The 12 edges of a cube, as pairs of {@link CUBE_CORNERS} indices. */
const CUBE_EDGES = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7]
];

/**
 * The voxel lattice as a {@link import('../proxyGeometry.js').ProxyGeometry}.
 *
 * Everything outside this directory sees a body's discretisation through the
 * entries below and nothing else; `lattice` is the one exception, and it is
 * temporary: the elastic constraint still reads cells and colours straight off
 * it, until it moves in here and is handed out as this lattice's own.
 *
 * How the lattice meets each invariant is written next to the entry that
 * carries it.
 *
 * @implements {import('../proxyGeometry.js').ProxyGeometry}
 */
export class VoxelLattice {
    /**
     * @param {import('./lattice.js').Lattice} lattice - The bare grid, already built.
     */
    constructor(lattice) {
        /** The bare grid. Read from outside only by `ElasticCells`, and not for long. */
        this.lattice = lattice;

        // Dense, inactive nodes included: `nodeCount` is every slot the grid
        // indexes, and the ones no occupied cell touches carry zero inverse
        // mass, which is all I1 lets that zero mean.
        this.dof = {
            restPositions: lattice.restPositions,
            invMass: lattice.invMass,
            nodeCount: lattice.nodeCount
        };

        // Every node with material is the corner of an occupied cell, whose
        // edges put a neighbour exactly `h` away and none closer: the grid
        // spacing is both the smallest and the largest nearest-neighbour gap.
        this.spacing = { min: lattice.h, max: lattice.h };

        // The thinnest a cell gets is its edge, since all of them are the same
        // cube.
        this.cflLength = lattice.h;

        /** @type {import('../proxyGeometry.js').ContactSurface|null} */
        this.surface = null;
    }

    /** @returns {import('../proxyGeometry.js').ContactSurface} The boundary nodes and their radii. */
    contactSurface() {
        if (!this.surface) {
            const nodes = surfaceNodes(this.lattice);
            const radii = new Float32Array(nodes.length).fill(this.lattice.h * CONTACT_RADIUS_CELLS);
            this.surface = { nodes, radii };
        }
        return this.surface;
    }

    /**
     * @param {object} nodePositions - Live node buffer for the whole scene.
     * @param {number} nodeOffset - Where this body's nodes start in it.
     * @returns {import('../../../deformation/bind.js').DeformationField} This body's deformation.
     */
    field(nodePositions, nodeOffset) {
        const { origin, h, cellDims, nodeDims } = this.lattice;
        return latticeField({ nodePositions, origin, h, cellDims, nodeDims, nodeOffset });
    }

    /**
     * One cube per occupied cell, grouped by the cell's parallel-solve colour.
     *
     * Every cell gets its own eight vertices rather than sharing corners with its
     * neighbours, because each vertex is pulled towards its own cell's centre:
     * `offsets` is the vector from the corner to that centre, so pulling by a
     * fraction below one keeps the cube inside its cell. Showing occupancy and
     * colouring in one picture is deliberate. Occupancy tells you whether
     * voxelisation leaked or missed a limb; the colouring is what the GPU
     * solver's correctness rests on, and a broken parity rule shows up as a flat
     * patch of one group.
     *
     * @returns {import('../proxyGeometry.js').Wireframe} The cubes.
     */
    wireframe() {
        const { cells, cellDims, nodeDims, restPositions, colorRanges, h } = this.lattice;
        const count = cells.length;

        const positions = new Float32Array(count * 8 * 3);
        const offsets = new Float32Array(count * 8 * 3);
        const indices = new Uint32Array(count * CUBE_EDGES.length * 2);
        const corners = new Uint32Array(8);
        const coord = [0, 0, 0];
        let vertex = 0;
        let index = 0;

        // `cells` is already grouped by colour, so walking it in order lays
        // the segments out group by group.
        for (let c = 0; c < count; c++) {
            cellCoords(cellDims, cells[c], coord);
            cellNodeIndices(nodeDims, coord[0], coord[1], coord[2], corners);
            const base = vertex;

            for (let corner = 0; corner < 8; corner++) {
                const node = corners[corner];
                for (let axis = 0; axis < 3; axis++) {
                    positions[vertex * 3 + axis] = restPositions[node * 3 + axis];
                    offsets[vertex * 3 + axis] = CUBE_CORNERS[corner][axis] ? -h / 2 : h / 2;
                }
                vertex++;
            }

            for (const [a, b] of CUBE_EDGES) {
                indices[index++] = base + a;
                indices[index++] = base + b;
            }
        }

        const segmentsPerCell = CUBE_EDGES.length * 2;
        const groups = colorRanges.map(({ start, count: inGroup }) => ({
            start: start * segmentsPerCell,
            count: inGroup * segmentsPerCell
        }));

        return { positions, offsets, indices, groups };
    }

    /** @returns {import('../proxyGeometry.js').Scale} How many cells the body was cut into. */
    scale() {
        return { label: '格', value: this.lattice.cells.length };
    }

    /**
     * Re-spreads node masses after a density change.
     *
     * Node masses exist because the lattice lumps a cell's mass onto its
     * corners, so keeping them consistent with `density * volume` is this
     * module's job, not the body's. Applied as a ratio in place, so an inactive
     * node's zero stays zero (I1) and `Particles`, which holds this same array,
     * only has to re-upload it.
     *
     * @param {number} previous - Density the masses were built from, kg/m^3.
     * @param {number} density - New density, kg/m^3.
     */
    setDensity(previous, density) {
        const ratio = previous / density;
        const { invMass, nodeCount } = this.lattice;
        for (let n = 0; n < nodeCount; n++) {
            invMass[n] *= ratio;
        }
        this.lattice.mass = this.lattice.volume * density;
    }
}
