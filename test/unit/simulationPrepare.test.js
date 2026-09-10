import { describe, expect, it } from 'vitest';

import { prepareSceneSimulation } from '../../src/app/simulationPrepare.js';
import { createSimulationPreparationTask } from '../../src/app/simulationWorkerClient.js';

function surfel() {
    return {
        id: 7,
        name: 'tilted sheet',
        cloud: {
            count: 1,
            dimensionality: 2,
            positions: new Float32Array([0.5, 0, 0]),
            rotations: new Float32Array([0, 0, 0, 1]),
            scales: new Float32Array([0.2, 0.1, 0]),
            opacity: new Float32Array([1]),
            sphericalHarmonics: Array.from({ length: 45 }, () => new Float32Array([1]))
        }
    };
}

const reference = {
    min: [-1, -1, -1], max: [1, 1, 1], center: [0, 0, 0],
    extent: [2, 2, 2], longest: 2, count: 2
};
const material = { density: 800, youngsModulus: 2e5, poissonRatio: 0.3 };

describe('worker-safe simulation preparation', () => {
    it('transforms only simulation geometry and computes density times occupied volume', () => {
        const instance = surfel();
        const progress = [];
        const prepared = prepareSceneSimulation({
            instance,
            reference,
            calibration: { upAxis: '+Y', longestMeters: 4, position: [1, 2, 3] },
            material,
            resolution: 16
        }, update => progress.push(update.phase));

        expect([...instance.cloud.positions]).toEqual([0.5, 0, 0]);
        expect([...prepared.body.source.cloud.positions]).toEqual([2, 2, 3]);
        expect(prepared.body.source.cloud.scales[0]).toBeCloseTo(0.4, 6);
        expect(prepared.body.source.cloud.scales[1]).toBeCloseTo(0.2, 6);
        expect(prepared.body.source.cloud.scales[2]).toBe(0);
        expect(prepared.body.source.cloud.sphericalHarmonics).toBeUndefined();
        expect(prepared.lattice.mass).toBeCloseTo(material.density * prepared.lattice.volume, 10);
        expect(prepared.metrics.occupiedCells).toBe(prepared.lattice.cells.length);
        expect(progress).toEqual(['transform', 'discretize', 'ready']);
    });

    it('rejects an invalid latest material before doing CPU preparation', () => {
        expect(() => prepareSceneSimulation({
            instance: surfel(), reference, calibration: {},
            material: { ...material, poissonRatio: 0.1 }
        })).toThrow(/Poisson ratio/);
    });
});

class FakeWorker {
    constructor() { FakeWorker.latest = this; }
    postMessage(message) { this.message = message; }
    terminate() { this.terminated = true; }
}

describe('simulation preparation worker boundary', () => {
    it('terminates immediately on cancellation and ignores a late result', async () => {
        const progress = [];
        const task = createSimulationPreparationTask({ instance: surfel() },
            update => progress.push(update), { WorkerClass: FakeWorker, workerUrl: '/simulation-worker.js' });
        expect(task.cancel()).toBe(true);
        FakeWorker.latest.onmessage({ data: { type: 'result', result: { late: true } } });

        await expect(task.promise).rejects.toMatchObject({ name: 'SimulationPreparationCancelledError' });
        expect(FakeWorker.latest.terminated).toBe(true);
        expect(progress).toEqual([]);
    });
});
