/** Bytes occupied by one vec4 particle value in the shared GPU buffers. */
const PARTICLE_VECTOR_BYTES = 4 * Float32Array.BYTES_PER_ELEMENT;

/** Dynamic fields preserved for a body that already belongs to the simulation. */
const DYNAMIC_FIELDS = ['nodePos', 'nodePrev', 'nodeVel'];

/**
 * Describes an append without touching either live or candidate GPU resources.
 *
 * The rest positions are deliberately part of validation and absent from the
 * returned copy ranges. They describe the material's undeformed reference and
 * must come from the original prepared body even when the live positions have
 * moved. Only the three dynamic fields are eligible for migration.
 *
 * @param {{ id: string|number, nodeCount: number, restPositions: Float32Array }[]} previousBodies
 *   Bodies at the frozen complete-step boundary.
 * @param {{ id: string|number, nodeCount: number, restPositions: Float32Array }[]} candidateBodies
 *   All bodies in the candidate shared simulation.
 * @returns {{ ranges: { id: string|number, sourceNodeOffset: number,
 *   destinationNodeOffset: number, nodeCount: number }[], addedIds: (string|number)[],
 *   previousNodeCount: number, candidateNodeCount: number }} An immutable copy plan.
 */
export function planParticleMigration(previousBodies, candidateBodies) {
    const previous = indexBodies(previousBodies, 'previous');
    const candidate = indexBodies(candidateBodies, 'candidate');
    const ranges = [];

    for (const source of previous.entries) {
        const destination = candidate.byId.get(source.id);
        if (!destination) {
            throw new Error(`missing old body ${String(source.id)} from particle migration candidate`);
        }
        if (source.nodeCount !== destination.nodeCount) {
            throw new Error(
                `node count changed for old body ${String(source.id)}: ` +
                `${source.nodeCount} -> ${destination.nodeCount}`
            );
        }
        if (!sameValues(source.restPositions, destination.restPositions)) {
            throw new Error(`rest positions changed for old body ${String(source.id)}`);
        }
        ranges.push(Object.freeze({
            id: source.id,
            sourceNodeOffset: source.nodeOffset,
            destinationNodeOffset: destination.nodeOffset,
            nodeCount: source.nodeCount
        }));
    }

    const addedIds = candidate.entries
        .filter(entry => !previous.byId.has(entry.id))
        .map(entry => entry.id);

    return Object.freeze({
        ranges: Object.freeze(ranges),
        addedIds: Object.freeze(addedIds),
        previousNodeCount: previous.nodeCount,
        candidateNodeCount: candidate.nodeCount
    });
}

/**
 * Records direct GPU-to-GPU copies for every old body's dynamic state.
 *
 * Candidate construction has already initialized every body from its rest
 * positions with zero velocity. Copying only old ranges therefore leaves new
 * bodies in that state. Inverse mass and parameter buffers are intentionally
 * excluded so the candidate's latest material values remain authoritative.
 * This function neither publishes nor destroys resources; both particle sets
 * remain owned by their simulators if recording a copy throws.
 *
 * @param {object} previousParticles - Frozen live particle owner.
 * @param {object} candidateParticles - Unpublished candidate particle owner.
 * @param {ReturnType<typeof planParticleMigration>} plan - Validated body ranges.
 */
export function copyParticleMigration(previousParticles, candidateParticles, plan) {
    const ranges = validateCopyInputs(previousParticles, candidateParticles, plan);

    for (const { sourceNodeOffset, destinationNodeOffset, nodeCount } of ranges) {
        const sourceOffset = sourceNodeOffset * PARTICLE_VECTOR_BYTES;
        const destinationOffset = destinationNodeOffset * PARTICLE_VECTOR_BYTES;
        const byteSize = nodeCount * PARTICLE_VECTOR_BYTES;
        for (const field of DYNAMIC_FIELDS) {
            candidateParticles[field].copy(
                previousParticles[field], sourceOffset, destinationOffset, byteSize
            );
        }
    }
}

function indexBodies(bodies, label) {
    if (!Array.isArray(bodies)) {
        throw new TypeError(`${label} bodies must be an array`);
    }

    const entries = [];
    const byId = new Map();
    let nodeOffset = 0;
    for (const body of bodies) {
        if (!body || !validId(body.id)) {
            throw new TypeError(`${label} body has an invalid stable id`);
        }
        if (byId.has(body.id)) {
            throw new Error(`duplicate body id ${String(body.id)} in ${label} bodies`);
        }
        if (!Number.isInteger(body.nodeCount) || body.nodeCount < 1) {
            throw new RangeError(`${label} body ${String(body.id)} has an invalid node count`);
        }
        if (!(body.restPositions instanceof Float32Array) ||
            body.restPositions.length !== body.nodeCount * 3 ||
            !body.restPositions.every(Number.isFinite)) {
            throw new TypeError(`${label} body ${String(body.id)} has invalid rest positions`);
        }

        const entry = { ...body, nodeOffset };
        entries.push(entry);
        byId.set(body.id, entry);
        nodeOffset += body.nodeCount;
    }
    return { entries, byId, nodeCount: nodeOffset };
}

function validId(id) {
    return (typeof id === 'string' && id.length > 0) ||
        (typeof id === 'number' && Number.isFinite(id));
}

function sameValues(left, right) {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) {
        if (left[i] !== right[i]) return false;
    }
    return true;
}

function validateCopyInputs(previous, candidate, plan) {
    if (!plan || !Array.isArray(plan.ranges)) {
        throw new TypeError('particle migration plan must contain ranges');
    }
    for (const field of DYNAMIC_FIELDS) {
        if (!previous?.[field] || typeof candidate?.[field]?.copy !== 'function') {
            throw new TypeError(`particle migration requires ${field} source and destination buffers`);
        }
    }
    for (const range of plan.ranges) {
        for (const field of ['sourceNodeOffset', 'destinationNodeOffset', 'nodeCount']) {
            if (!Number.isInteger(range?.[field]) || range[field] < (field === 'nodeCount' ? 1 : 0)) {
                throw new RangeError(`particle migration range has invalid ${field}`);
            }
        }
        if (Number.isInteger(plan.previousNodeCount) &&
            range.sourceNodeOffset + range.nodeCount > plan.previousNodeCount) {
            throw new RangeError('particle migration source range exceeds previous particles');
        }
        if (Number.isInteger(plan.candidateNodeCount) &&
            range.destinationNodeOffset + range.nodeCount > plan.candidateNodeCount) {
            throw new RangeError('particle migration destination range exceeds candidate particles');
        }
    }
    return plan.ranges;
}
