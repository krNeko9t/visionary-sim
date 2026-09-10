import { describe, expect, it, vi } from 'vitest';

import { SimulationSession } from '../../src/app/simulationSession.js';

function preparation(overrides = {}) {
    return {
        source: { contentKey: 'scene-a' },
        transform: { scale: 1 },
        calibration: { longestMeters: 1 },
        container: { position: [0, 0, 0], dimensions: [2, 2, 2] },
        ...overrides
    };
}

function runtime() {
    return {
        freeze: vi.fn(async () => {}),
        resume: vi.fn(async () => {}),
        returnToPreparation: vi.fn(async () => {}),
        dispose: vi.fn(async () => {}),
        getClock: vi.fn(() => 0)
    };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

describe('scene simulation session', () => {
    it('can stage a restored participant list without starting simulation', () => {
        const session = new SimulationSession({
            preparation: preparation(),
            participantIds: [7, 12],
            readMaterials: vi.fn(),
            createCandidate: vi.fn()
        });

        expect(session.getState()).toMatchObject({
            phase: 'preparation',
            participantIds: [7, 12],
            clock: 0,
            grabbing: false
        });
    });

    it('publishes a whole participant list with the latest valid materials', async () => {
        const published = runtime();
        const candidate = {
            publish: vi.fn(async () => published),
            discard: vi.fn()
        };
        const readMaterials = vi.fn(ids => Object.fromEntries(ids.map(id => [id, {
            density: 700 + readMaterials.mock.calls.length,
            youngsModulus: 1e5,
            poissonRatio: 0.3
        }])));
        const createCandidate = vi.fn(async () => candidate);
        const session = new SimulationSession({
            preparation: preparation(),
            readMaterials,
            createCandidate
        });

        session.setParticipants([7, 12]);
        await session.start();

        expect(session.getState()).toMatchObject({
            phase: 'running',
            participantIds: [7, 12],
            clock: 0,
            grabbing: true,
            error: null
        });
        expect(createCandidate).toHaveBeenCalledWith(expect.objectContaining({
            participantIds: [7, 12],
            materials: {
                7: { density: 701, youngsModulus: 1e5, poissonRatio: 0.3 },
                12: { density: 701, youngsModulus: 1e5, poissonRatio: 0.3 }
            },
            previousRuntime: null,
            signal: expect.any(AbortSignal),
            cache: null
        }));
        expect(candidate.publish).toHaveBeenCalledWith({
            materials: {
                7: { density: 702, youngsModulus: 1e5, poissonRatio: 0.3 },
                12: { density: 702, youngsModulus: 1e5, poissonRatio: 0.3 }
            },
            signal: expect.any(AbortSignal),
            readMaterials: expect.any(Function)
        });
        expect(candidate.discard).not.toHaveBeenCalled();
    });

    it('returns a running scene to its source layout while retaining preparation edits and participants', async () => {
        const source = { contentKey: 'scene-a', rows: new Uint32Array([4, 5]) };
        const calibration = { longestMeters: 2, upAxis: '+Z' };
        const container = { position: [1, 2, 3], dimensions: [4, 5, 6] };
        const published = runtime();
        published.getClock.mockReturnValue(3.75);
        const session = new SimulationSession({
            preparation: preparation({ source, calibration, container }),
            readMaterials: () => ({ 7: { density: 900, youngsModulus: 2e5, poissonRatio: 0.32 } }),
            createCandidate: async () => ({ publish: async () => published, discard: vi.fn() })
        });
        session.setParticipants([7]);
        await session.start();
        expect(session.getState()).toMatchObject({ clock: 3.75, grabbing: true });

        await session.returnPreparation();

        expect(published.returnToPreparation).toHaveBeenCalledOnce();
        expect(session.getState()).toEqual({
            phase: 'preparation',
            preparation: { source, transform: { scale: 1 }, calibration, container },
            participantIds: [7],
            clock: 0,
            grabbing: false,
            progress: null,
            error: null
        });
    });

    it('locks preparation edits and restart until old runtime cleanup completes', async () => {
        const cleanup = deferred();
        const published = runtime();
        published.returnToPreparation.mockImplementation(() => cleanup.promise);
        const session = new SimulationSession({
            preparation: preparation(),
            readMaterials: () => ({ 7: { density: 800, youngsModulus: 1e5, poissonRatio: 0.3 } }),
            createCandidate: async () => ({ publish: async () => published, discard: vi.fn() })
        });
        session.setParticipants([7]);
        await session.start();

        const returning = session.returnPreparation();
        expect(session.getState()).toMatchObject({ phase: 'returning', clock: 0, grabbing: false });
        await expect(session.start()).rejects.toThrow(/return.*progress/i);
        expect(() => session.setParticipants([7, 12])).toThrow(/return.*progress/i);
        expect(() => session.updatePreparation({ transform: { scale: 2 } })).toThrow(/return.*progress/i);
        await expect(session.addParticipant(12)).rejects.toThrow(/return.*progress/i);
        expect(session.getState().participantIds).toEqual([7]);

        cleanup.resolve();
        await returning;
        expect(session.getState().phase).toBe('preparation');
    });

    it('cancels preparation and discards a late candidate without publishing it', async () => {
        const pending = deferred();
        const candidate = { publish: vi.fn(), discard: vi.fn() };
        const session = new SimulationSession({
            preparation: preparation(),
            readMaterials: () => ({ 7: { density: 800, youngsModulus: 1e5, poissonRatio: 0.3 } }),
            createCandidate: () => pending.promise
        });
        session.setParticipants([7]);

        const start = session.start();
        await Promise.resolve();
        expect(session.cancelPreparation()).toBe(true);
        pending.resolve(candidate);

        await expect(start).rejects.toMatchObject({ name: 'SimulationCancelledError' });
        expect(candidate.publish).not.toHaveBeenCalled();
        expect(candidate.discard).toHaveBeenCalledOnce();
        expect(session.getState()).toMatchObject({
            phase: 'preparation',
            participantIds: [7],
            clock: 0,
            grabbing: false,
            error: null
        });
        expect(session.cancelPreparation()).toBe(false);
    });

    it('uses the same whole-list task for append and keeps the old runtime frozen when latest material is invalid', async () => {
        const original = runtime();
        original.getClock.mockReturnValue(1.25);
        const candidate = { publish: vi.fn(), discard: vi.fn() };
        let reads = 0;
        const readMaterials = vi.fn(ids => {
            reads++;
            if (reads === 4) throw new Error('instance 12 has an invalid Poisson ratio');
            return Object.fromEntries(ids.map(id => [id, {
                density: 800,
                youngsModulus: 1e5,
                poissonRatio: 0.3
            }]));
        });
        const createCandidate = vi.fn()
            .mockResolvedValueOnce({ publish: async () => original, discard: vi.fn() })
            .mockResolvedValueOnce(candidate);
        const session = new SimulationSession({
            preparation: preparation(),
            readMaterials,
            createCandidate
        });
        session.setParticipants([7]);
        await session.start();

        await expect(session.addParticipant(12)).rejects.toThrow('invalid Poisson ratio');

        expect(original.freeze).toHaveBeenCalledOnce();
        expect(createCandidate.mock.calls[1][0]).toMatchObject({
            participantIds: [7, 12],
            previousRuntime: original
        });
        expect(candidate.publish).not.toHaveBeenCalled();
        expect(candidate.discard).toHaveBeenCalledOnce();
        expect(session.getState()).toMatchObject({
            phase: 'paused',
            participantIds: [7, 12],
            clock: 1.25,
            grabbing: false,
            error: 'instance 12 has an invalid Poisson ratio'
        });

        await session.returnPreparation();
        expect(original.returnToPreparation).toHaveBeenCalledOnce();
    });

    it('pauses and resumes the shared runtime while exposing its clock and grab state', async () => {
        let publishClock;
        const published = {
            ...runtime(),
            subscribeClock(listener) {
                publishClock = listener;
                return () => { publishClock = null; };
            }
        };
        const session = new SimulationSession({
            preparation: preparation(),
            readMaterials: () => ({ 7: { density: 800, youngsModulus: 1e5, poissonRatio: 0.3 } }),
            createCandidate: async () => ({ publish: async () => published, discard: vi.fn() })
        });
        session.setParticipants([7]);
        await session.start();
        publishClock(2.5);

        await session.pause();
        expect(session.getState()).toMatchObject({ phase: 'paused', clock: 2.5, grabbing: false });
        expect(published.freeze).toHaveBeenCalledOnce();

        await session.resume();
        expect(session.getState()).toMatchObject({ phase: 'running', clock: 2.5, grabbing: true });
        expect(published.resume).toHaveBeenCalledOnce();
    });

    it('synchronizes a valid material through the opaque runtime without resetting it', async () => {
        const published = { ...runtime(), setMaterial: vi.fn(() => true) };
        const readMaterials = vi.fn(() => ({
            7: { density: 950, youngsModulus: 3e5, poissonRatio: 0.34 }
        }));
        const session = new SimulationSession({
            preparation: preparation(),
            participantIds: [7],
            readMaterials,
            createCandidate: async () => ({ publish: async () => published, discard: vi.fn() })
        });
        await session.start();
        readMaterials.mockClear();

        await expect(session.synchronizeMaterial(7)).resolves.toBe(true);
        expect(readMaterials).toHaveBeenCalledWith([7]);
        expect(published.setMaterial).toHaveBeenCalledWith(7,
            { density: 950, youngsModulus: 3e5, poissonRatio: 0.34 });
        expect(session.getState().phase).toBe('running');
    });

    it('reuses rebuildable cache only while the source transform remains current', async () => {
        const reusable = { volume: 'cached-source-voxels' };
        const runtimes = [runtime(), runtime(), runtime()];
        const seenCaches = [];
        let candidateIndex = 0;
        const session = new SimulationSession({
            preparation: preparation(),
            readMaterials: () => ({ 7: { density: 800, youngsModulus: 1e5, poissonRatio: 0.3 } }),
            createCandidate: async input => {
                seenCaches.push(input.cache);
                const nextRuntime = runtimes[candidateIndex++];
                return {
                    cache: reusable,
                    publish: async () => nextRuntime,
                    discard: vi.fn()
                };
            }
        });
        session.setParticipants([7]);

        await session.start();
        await session.returnPreparation();
        await session.start();
        await session.returnPreparation();
        session.updatePreparation({
            transform: { scale: 2 },
            calibration: { longestMeters: 2 }
        });
        await session.start();

        expect(seenCaches).toEqual([null, reusable, null]);
        expect(session.getState().preparation).toMatchObject({
            source: { contentKey: 'scene-a' },
            transform: { scale: 2 },
            calibration: { longestMeters: 2 },
            container: { position: [0, 0, 0], dimensions: [2, 2, 2] }
        });
    });

    it('returns during append immediately, releases the frozen runtime and rejects the late task', async () => {
        const original = runtime();
        const pending = deferred();
        const lateCandidate = { publish: vi.fn(), discard: vi.fn() };
        const createCandidate = vi.fn()
            .mockResolvedValueOnce({ publish: async () => original, discard: vi.fn() })
            .mockImplementationOnce(() => pending.promise);
        const session = new SimulationSession({
            preparation: preparation(),
            readMaterials: ids => Object.fromEntries(ids.map(id => [id, {
                density: 800,
                youngsModulus: 1e5,
                poissonRatio: 0.3
            }])),
            createCandidate
        });
        session.setParticipants([7]);
        await session.start();
        const append = session.addParticipant(12);
        await vi.waitFor(() => expect(createCandidate).toHaveBeenCalledTimes(2));

        await session.returnPreparation();
        session.updatePreparation({
            transform: { scale: 1.5 },
            calibration: { longestMeters: 1.5 },
            container: { position: [3, 2, 1], dimensions: [5, 5, 5] }
        });
        pending.resolve(lateCandidate);

        await expect(append).rejects.toMatchObject({ name: 'SimulationCancelledError' });
        expect(original.freeze).toHaveBeenCalledOnce();
        expect(original.returnToPreparation).toHaveBeenCalledOnce();
        expect(lateCandidate.publish).not.toHaveBeenCalled();
        expect(lateCandidate.discard).toHaveBeenCalledOnce();
        expect(session.getState()).toMatchObject({
            phase: 'preparation',
            participantIds: [7, 12],
            preparation: {
                source: { contentKey: 'scene-a' },
                transform: { scale: 1.5 },
                calibration: { longestMeters: 1.5 },
                container: { position: [3, 2, 1], dimensions: [5, 5, 5] }
            },
            clock: 0,
            grabbing: false,
            error: null
        });
    });

    it('releases a runtime returned after cancellation during candidate publication', async () => {
        const publishing = deferred();
        const lateRuntime = runtime();
        const candidate = { publish: vi.fn(() => publishing.promise), discard: vi.fn() };
        const session = new SimulationSession({
            preparation: preparation(),
            readMaterials: () => ({ 7: { density: 800, youngsModulus: 1e5, poissonRatio: 0.3 } }),
            createCandidate: async () => candidate
        });
        session.setParticipants([7]);
        const start = session.start();
        await vi.waitFor(() => expect(candidate.publish).toHaveBeenCalledOnce());

        expect(session.cancelPreparation()).toBe(true);
        publishing.resolve(lateRuntime);

        await expect(start).rejects.toMatchObject({ name: 'SimulationCancelledError' });
        expect(lateRuntime.returnToPreparation).toHaveBeenCalledOnce();
        expect(candidate.discard).toHaveBeenCalledOnce();
        expect(session.getState()).toMatchObject({ phase: 'preparation', clock: 0, grabbing: false });
    });

    it('does not discard a committed candidate when optional clock subscription fails', async () => {
        const published = {
            ...runtime(),
            subscribeClock() { throw new Error('clock observer unavailable'); }
        };
        const candidate = { publish: vi.fn(async () => published), discard: vi.fn() };
        const session = new SimulationSession({
            preparation: preparation(),
            readMaterials: () => ({ 7: { density: 800, youngsModulus: 1e5, poissonRatio: 0.3 } }),
            createCandidate: async () => candidate
        });
        session.setParticipants([7]);

        await expect(session.start()).resolves.toBe(published);
        expect(session.getState().phase).toBe('running');
        expect(candidate.discard).not.toHaveBeenCalled();
    });

    it('disposes runtime, pending work and rebuildable cache idempotently', async () => {
        const published = runtime();
        const cached = { dispose: vi.fn() };
        const session = new SimulationSession({
            preparation: preparation(),
            readMaterials: () => ({ 7: { density: 800, youngsModulus: 1e5, poissonRatio: 0.3 } }),
            createCandidate: async () => ({
                cache: cached,
                publish: async () => published,
                discard: vi.fn()
            })
        });
        session.setParticipants([7]);
        await session.start();

        await session.dispose();
        await session.dispose();

        expect(published.dispose).toHaveBeenCalledOnce();
        expect(cached.dispose).toHaveBeenCalledOnce();
        expect(session.getState()).toMatchObject({
            phase: 'disposed',
            participantIds: [7],
            clock: 0,
            grabbing: false
        });
        await expect(session.start()).rejects.toThrow(/disposed/);
    });

    it('waits for an in-flight return during disposal and ignores its late phase update', async () => {
        const cleanup = deferred();
        const published = runtime();
        published.returnToPreparation.mockImplementation(() => cleanup.promise);
        const session = new SimulationSession({
            preparation: preparation(),
            participantIds: [7],
            readMaterials: () => ({ 7: { density: 800, youngsModulus: 1e5, poissonRatio: 0.3 } }),
            createCandidate: async () => ({ publish: async () => published, discard: vi.fn() })
        });
        await session.start();
        const returning = session.returnPreparation();
        const disposing = session.dispose();
        cleanup.resolve();

        await returning;
        await disposing;
        expect(session.getState().phase).toBe('disposed');
        expect(published.dispose).not.toHaveBeenCalled();
    });
});
