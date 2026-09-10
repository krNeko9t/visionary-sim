import { POISSON_RANGE } from '../body/material.js';
import { copyParticleMigration, planParticleMigration } from './state/migration.js';
import { stableStepDuration } from './solver/timestep.js';

/**
 * Gives a candidate private mutable body state while sharing immutable geometry.
 *
 * The live simulator may accept material edits while an append is preparing.
 * Sharing either the material object or the lattice inverse masses would let
 * those edits mutate the candidate behind its publication checks. Rest geometry
 * and cell topology are safe to share: neither simulation is allowed to rewrite
 * them, and migration verifies that the candidate kept the same rest positions.
 *
 * @param {object[]} entries - Prepared simulation bodies, including stable IDs.
 * @returns {object[]} Candidate-owned body entries.
 */
export function isolateCandidateBodies(entries) {
    if (!Array.isArray(entries)) throw new TypeError('simulation bodies must be an array');
    return entries.map((entry) => {
        if (!entry?.body?.material || !entry?.lattice?.invMass) {
            throw new TypeError('candidate body needs body material and lattice inverse masses');
        }
        const body = cloneObject(entry.body, {
            material: { ...entry.body.material }
        });
        const lattice = cloneObject(entry.lattice, {
            invMass: new Float32Array(entry.lattice.invMass)
        });
        return { ...entry, body, lattice };
    });
}

/**
 * Freezes a live simulator at a complete dispatch boundary and drains its GPU work.
 *
 * `appendFrozen` is set before any asynchronous boundary. Simulator.step and
 * requestStep use that gate once the thin public methods are connected, so no
 * manual request can advance particles while the queue drain is pending.
 *
 * @param {object} simulator - Live Simulator instance.
 */
export async function freezeForAppend(simulator) {
    if (!simulator?.alive) throw new Error('cannot freeze a disposed simulator');
    if (typeof simulator.device?.submit !== 'function' ||
        typeof simulator.device?.wgpu?.queue?.onSubmittedWorkDone !== 'function') {
        throw new Error('append freeze requires a WebGPU submission queue');
    }

    simulator.appendFrozen = true;
    simulator.params.paused = true;
    simulator.pendingStep = false;
    simulator.releaseGrab();
    simulator.device.submit();
    await simulator.device.wgpu.queue.onSubmittedWorkDone();

    if (!simulator.alive) throw new Error('simulator was disposed while freezing for append');
}

/**
 * Records old dynamic state into an unpublished candidate and clones its clock.
 *
 * Both simulators remain owned by their callers. No old resource is released;
 * if a copy cannot be recorded the candidate can be destroyed independently and
 * the previous simulator stays frozen. The candidate's constructor-selected
 * step duration is retained for future work while every existing accounting
 * field comes from the previous clock.
 *
 * @param {object} previous - Frozen live Simulator.
 * @param {object} candidate - Unpublished candidate Simulator.
 * @returns {ReturnType<typeof planParticleMigration>} Recorded migration plan.
 */
export function migrateFrozenState(previous, candidate) {
    if (!previous?.appendFrozen || !previous.params?.paused) {
        throw new Error('previous simulator must be frozen before migration');
    }
    if (!candidate || previous.device !== candidate.device) {
        throw new Error('particle migration requires simulators on the same device');
    }

    const plan = planParticleMigration(
        migrationBodies(previous.simBodies),
        migrationBodies(candidate.simBodies)
    );
    // Candidate validation is allowed to run real kernels. Reestablish the
    // constructor state before every migration so a post-probe migration also
    // returns appended bodies to source rest with zero velocity.
    candidate.particles.reset();
    copyParticleMigration(previous.particles, candidate.particles, plan);

    const candidateStepDuration = candidate.clock.stepDuration;
    candidate.clock = previous.clock.clone({ stepDuration: candidateStepDuration });
    candidate.params.paused = true;
    candidate.pendingStep = false;
    return plan;
}

/**
 * Applies one complete latest-material snapshot to an unpublished candidate.
 *
 * Validation happens before the first mutation. GPU masses and both parameter
 * buffers are uploaded even when a value equals the candidate's earlier copy;
 * correctness never relies on identity sharing or `density !== oldDensity`.
 *
 * @param {object} candidate - Candidate Simulator with private mutable body state.
 * @param {{ bodyId: string|number, material: object }[]} updates - One update per body.
 */
export function syncCandidateMaterials(candidate, updates) {
    if (!Array.isArray(updates)) throw new TypeError('latest material updates must be an array');
    const bodyIndex = new Map(candidate.simBodies.map((entry, index) => [entry.id, index]));
    if (bodyIndex.size !== candidate.simBodies.length) {
        throw new Error('candidate simulator has duplicate body IDs');
    }

    const seen = new Set();
    const checked = updates.map((update) => {
        const index = bodyIndex.get(update?.bodyId);
        if (index === undefined) throw new Error(`unknown candidate body ${String(update?.bodyId)}`);
        if (seen.has(update.bodyId)) throw new Error(`duplicate material update for ${String(update.bodyId)}`);
        seen.add(update.bodyId);
        validateMaterial(update.material, update.bodyId);
        return { index, material: { ...update.material } };
    });
    if (seen.size !== candidate.simBodies.length) {
        throw new Error('latest material snapshot must cover every candidate body');
    }

    for (const { index, material } of checked) {
        candidate.setMaterial(index, material);
    }

    // `setMaterial` is optimized for ordinary one-field edits. Publication is
    // a rarer trust boundary: force every mutable derived value to the device.
    candidate.particles.uploadMasses();
    for (let index = 0; index < candidate.simBodies.length; index++) {
        const { damping, friction } = candidate.simBodies[index].body.material;
        candidate.particles.setParams(index, { damping, friction });
    }
    candidate.elastic.uploadParams();
    candidate.clock.setStepDuration(stableStepDuration(candidate.waveRate()));
}

function migrationBodies(entries) {
    return entries.map(({ id, lattice }) => ({
        id,
        nodeCount: lattice.nodeCount,
        restPositions: lattice.restPositions
    }));
}

function cloneObject(source, overrides) {
    return Object.assign(Object.create(Object.getPrototypeOf(source)), source, overrides);
}

function validateMaterial(material, bodyId) {
    if (!material || !Number.isFinite(material.density) || material.density <= 0) {
        throw new Error(`body ${String(bodyId)} density must be a positive finite number`);
    }
    if (!Number.isFinite(material.youngsModulus) || material.youngsModulus <= 0) {
        throw new Error(`body ${String(bodyId)} Young modulus must be a positive finite number`);
    }
    if (!Number.isFinite(material.poissonRatio) ||
        material.poissonRatio < POISSON_RANGE.min || material.poissonRatio > POISSON_RANGE.max) {
        throw new Error(
            `body ${String(bodyId)} Poisson ratio must be within ` +
            `${POISSON_RANGE.min}..${POISSON_RANGE.max}`
        );
    }
}
