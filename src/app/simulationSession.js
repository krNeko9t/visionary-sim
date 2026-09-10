export class SimulationCancelledError extends Error {
    constructor() {
        super('simulation preparation was cancelled');
        this.name = 'SimulationCancelledError';
    }
}

/**
 * Owns one scene's participant list and atomic simulation lifecycle.
 *
 * `createCandidate` is the scene-specific simulation adapter. It receives the
 * immutable source scene, current transform/container, the whole participant
 * list, the latest material snapshot, an opaque previous runtime, cache data,
 * and one AbortSignal. It returns `{ publish({ materials, signal }), discard,
 * cache? }`. Publication must synchronously commit all simulator and display
 * bindings after its final signal check. A runtime supplies `freeze`, `resume`,
 * `returnToPreparation`, `dispose`, `getClock`, and optional `subscribeClock`.
 * Neither interface exposes particle or binding storage to this module.
 */
export class SimulationSession {
    constructor({ preparation, participantIds = [], readMaterials, createCandidate, cachePolicyVersion = 1 }) {
        validatePreparation(preparation);
        if (typeof readMaterials !== 'function' || typeof createCandidate !== 'function') {
            throw new TypeError('simulation session needs material and candidate adapters');
        }
        this.readMaterials = readMaterials;
        this.createCandidate = createCandidate;
        this.cachePolicyVersion = cachePolicyVersion;
        this.listeners = new Set();
        this.epoch = 0;
        this.active = null;
        this.runtime = null;
        this.unsubscribeClock = null;
        this.returnRuntime = null;
        this.returnPromise = null;
        this.disposePromise = null;
        this.disposed = false;
        this.cache = new Map();
        this.state = state({ preparation, participantIds: participantList(participantIds) });
    }

    getState = () => this.state;

    subscribe = (listener) => {
        this.requireActive();
        if (typeof listener !== 'function') throw new TypeError('listener must be a function');
        this.listeners.add(listener);
        try {
            listener(this.state);
        } catch (error) {
            this.listeners.delete(listener);
            throw error;
        }
        return () => this.listeners.delete(listener);
    };

    setParticipants = (ids) => {
        this.requirePreparationEdit();
        this.update({ participantIds: participantList(ids), error: null });
    };

    updatePreparation = (patch) => {
        this.requirePreparationEdit();
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
            throw new TypeError('preparation update must be an object');
        }
        const previous = this.state.preparation;
        const preparation = { ...previous, ...patch };
        validatePreparation(preparation);
        if ((patch.source !== undefined && patch.source !== previous.source) ||
            (patch.transform !== undefined && patch.transform !== previous.transform) ||
            (patch.calibration !== undefined && patch.calibration !== previous.calibration) ||
            (patch.parameters !== undefined && patch.parameters !== previous.parameters)) {
            this.clearCache();
        }
        this.update({ preparation, error: null });
    };

    addParticipant = (id) => {
        this.requireActive();
        if (this.returnPromise || this.state.phase === 'returning') {
            return Promise.reject(new Error('return to preparation is still in progress'));
        }
        if (this.active) return Promise.reject(new Error('simulation preparation is already running'));
        participantList([id]);
        if (this.state.participantIds.includes(id)) {
            return this.runtime ? Promise.resolve(this.runtime) : this.start();
        }
        this.update({ participantIds: [...this.state.participantIds, id], error: null });
        return this.start();
    };

    returnPreparation = () => {
        this.requireActive();
        if (this.returnPromise) return this.returnPromise;
        this.invalidateTask();
        const runtime = this.runtime ?? this.returnRuntime;
        this.runtime = null;
        this.returnRuntime = runtime;
        this.unbindClock();
        this.update({ phase: 'returning', clock: 0, grabbing: false, progress: null, error: null });
        const epoch = this.epoch;
        const operation = (async () => {
            try {
                await runtime?.returnToPreparation?.();
                if (!this.disposed && this.epoch === epoch) {
                    this.returnRuntime = null;
                    this.update({ phase: 'preparation', error: null });
                }
            } catch (error) {
                if (!this.disposed && this.epoch === epoch) {
                    this.update({ phase: 'returning', error: message(error) });
                }
                throw error;
            } finally {
                if (this.returnPromise === operation) this.returnPromise = null;
            }
        })();
        this.returnPromise = operation;
        return operation;
    };

    cancelPreparation = () => {
        this.requireActive();
        if (!this.invalidateTask()) return false;
        this.update({
            phase: this.runtime ? 'paused' : 'preparation',
            clock: this.runtime ? readClock(this.runtime) : 0,
            grabbing: false,
            progress: null,
            error: null
        });
        return true;
    };

    pause = async () => {
        this.requireActive();
        if (this.active) throw new Error('simulation preparation is already running');
        if (!this.runtime || this.state.phase !== 'running') throw new Error('simulation is not running');
        const runtime = this.runtime;
        await runtime.freeze();
        if (runtime !== this.runtime) return;
        this.update({ phase: 'paused', grabbing: false, error: null });
    };

    resume = async () => {
        this.requireActive();
        if (this.active) throw new Error('simulation preparation is already running');
        if (!this.runtime || this.state.phase !== 'paused') throw new Error('simulation is not paused');
        const runtime = this.runtime;
        await runtime.resume();
        if (runtime !== this.runtime) return;
        this.update({ phase: 'running', grabbing: runtime.getGrabbing?.() ?? true, error: null });
    };

    setGrabbing = async (enabled) => {
        this.requireActive();
        if (typeof enabled !== 'boolean') throw new TypeError('grabbing requires a boolean');
        if (this.active || !this.runtime || this.state.phase !== 'running') {
            throw new Error('grabbing can only be changed while running');
        }
        const runtime = this.runtime;
        await runtime.setGrabbing(enabled);
        if (runtime !== this.runtime || this.state.phase !== 'running') return;
        this.update({ grabbing: runtime.getGrabbing?.() ?? enabled, error: null });
    };

    synchronizeMaterial = async (id) => {
        this.requireActive();
        participantList([id]);
        const runtime = this.runtime;
        if (!runtime?.setMaterial) return false;
        const materials = await this.readMaterials([id]);
        if (this.disposed || runtime !== this.runtime) return false;
        return runtime.setMaterial(id, materials[id] ?? materials.get?.(id));
    };

    dispose = () => {
        if (this.disposePromise) return this.disposePromise;
        if (this.disposed) return Promise.resolve();
        this.disposed = true;
        this.invalidateTask();
        const runtime = this.runtime;
        const returningRuntime = this.returnRuntime;
        const returning = this.returnPromise;
        this.runtime = null;
        this.returnRuntime = null;
        this.returnPromise = null;
        this.unbindClock();
        this.disposePromise = (async () => {
            let returnFailed = false;
            if (returning) {
                try { await returning; } catch { returnFailed = true; }
            }
            try {
                await runtime?.dispose?.();
                if (returnFailed && returningRuntime !== runtime) await returningRuntime?.dispose?.();
            } finally {
                this.clearCache();
                this.update({
                    phase: 'disposed',
                    clock: 0,
                    grabbing: false,
                    progress: null,
                    error: null
                });
                this.listeners.clear();
            }
        })();
        return this.disposePromise;
    };

    start = async () => {
        this.requireActive();
        if (this.returnPromise || this.state.phase === 'returning') {
            throw new Error('return to preparation is still in progress');
        }
        if (this.active) return this.active.promise;
        const participantIds = [...this.state.participantIds];
        if (participantIds.length === 0) throw new Error('simulation needs at least one participating instance');

        const epoch = ++this.epoch;
        const controller = new AbortController();
        const previousRuntime = this.runtime;
        const active = { epoch, controller, candidate: null, discarded: false, promise: null };
        this.active = active;
        this.update({ phase: 'preparing', progress: null, error: null, grabbing: false });

        active.promise = (async () => {
            let candidate = null;
            let committed = false;
            try {
                if (previousRuntime) await previousRuntime.freeze();
                this.assertCurrent(active);
                const materials = await this.readMaterials(participantIds);
                this.assertCurrent(active);
                const cacheKey = preparationCacheKey(this.state.preparation, this.cachePolicyVersion);
                candidate = await this.createCandidate({
                    ...this.state.preparation,
                    participantIds,
                    materials,
                    previousRuntime,
                    cache: this.cache.get(cacheKey) ?? null,
                    cacheKey,
                    signal: controller.signal,
                    onProgress: progress => {
                        if (this.isCurrent(active)) this.update({ progress });
                    }
                });
                active.candidate = candidate;
                this.assertCurrent(active);
                const latestMaterials = await this.readMaterials(participantIds);
                this.assertCurrent(active);
                const nextRuntime = await candidate.publish({
                    materials: latestMaterials,
                    signal: controller.signal,
                    readMaterials: () => this.readMaterials(participantIds)
                });
                if (!this.isCurrent(active)) {
                    await releaseLateRuntime(nextRuntime);
                    throw new SimulationCancelledError();
                }
                this.runtime = nextRuntime;
                committed = true;
                if (candidate.cache !== undefined) this.rememberCache(cacheKey, candidate.cache);
                this.update({
                    phase: 'running',
                    clock: readClock(nextRuntime),
                    grabbing: true,
                    progress: null,
                    error: null
                });
                this.bindClock(nextRuntime);
                return nextRuntime;
            } catch (error) {
                if (candidate && !committed) this.discard(active, candidate);
                const cancelled = !this.isCurrent(active) || isCancellation(error);
                if (this.isCurrent(active)) {
                    this.update({
                        phase: previousRuntime ? 'paused' : 'preparation',
                        clock: previousRuntime ? readClock(previousRuntime) : 0,
                        grabbing: false,
                        progress: null,
                        error: cancelled ? null : message(error)
                    });
                }
                if (cancelled) throw new SimulationCancelledError();
                throw error;
            } finally {
                if (this.active === active) this.active = null;
            }
        })();
        return active.promise;
    };

    requireActive() {
        if (this.disposed) throw new Error('simulation session has been disposed');
    }

    requirePreparationEdit() {
        this.requireActive();
        if (this.returnPromise || this.state.phase === 'returning') {
            throw new Error('return to preparation is still in progress');
        }
        if (this.runtime || this.active || this.state.phase !== 'preparation') {
            throw new Error('return to preparation before editing the participant list');
        }
    }

    isCurrent(active) {
        return !this.disposed && this.active === active && this.epoch === active.epoch && !active.controller.signal.aborted;
    }

    assertCurrent(active) {
        if (!this.isCurrent(active)) throw new SimulationCancelledError();
    }

    discard(active, candidate) {
        if (active.discarded) return;
        active.discarded = true;
        try { candidate.discard(); } catch (error) {
            console.error('[simulation-session] candidate cleanup failed', error);
        }
    }

    bindClock(runtime) {
        this.unsubscribeClock?.();
        this.unsubscribeClock = null;
        if (typeof runtime?.subscribeClock !== 'function') return;
        try {
            this.unsubscribeClock = runtime.subscribeClock(clock => {
                if (this.runtime !== runtime || !Number.isFinite(clock) || clock < 0) return;
                this.update({ clock });
            });
        } catch (error) {
            console.error('[simulation-session] clock subscription failed', error);
        }
    }

    unbindClock() {
        this.unsubscribeClock?.();
        this.unsubscribeClock = null;
    }

    clearCache() {
        for (const value of this.cache.values()) {
            try { value?.dispose?.(); } catch (error) {
                console.error('[simulation-session] cache cleanup failed', error);
            }
        }
        this.cache.clear();
    }

    rememberCache(key, value) {
        const previous = this.cache.get(key);
        if (previous !== undefined && previous !== value) {
            try { previous?.dispose?.(); } catch (error) {
                console.error('[simulation-session] replaced cache cleanup failed', error);
            }
        }
        this.cache.set(key, value);
    }

    invalidateTask() {
        ++this.epoch;
        const active = this.active;
        if (!active) return false;
        this.active = null;
        active.controller.abort();
        if (active.candidate) this.discard(active, active.candidate);
        return true;
    }

    update(patch) {
        this.state = state({ ...this.state, ...patch });
        for (const listener of this.listeners) {
            try { listener(this.state); } catch (error) {
                console.error('[simulation-session] subscriber failed', error);
            }
        }
    }
}

function state({
    phase = 'preparation', preparation, participantIds = [], clock = 0,
    grabbing = false, progress = null, error = null
}) {
    return Object.freeze({
        phase,
        preparation: Object.freeze({ ...preparation }),
        participantIds: Object.freeze([...participantIds]),
        clock,
        grabbing,
        progress,
        error
    });
}

function participantList(ids) {
    if (!Array.isArray(ids)) throw new TypeError('participant IDs must be an array');
    const unique = new Set();
    for (const id of ids) {
        if (!Number.isInteger(id) || id <= 0) throw new Error(`participant ID must be a positive integer; received ${id}`);
        if (unique.has(id)) throw new Error(`duplicate participant ID ${id}`);
        unique.add(id);
    }
    return [...unique];
}

function validatePreparation(preparation) {
    if (!preparation?.source || !preparation?.transform || !preparation?.calibration || !preparation?.container) {
        throw new Error('simulation session needs source, transform, calibration and container preparation');
    }
}

function preparationCacheKey(preparation, version) {
    return JSON.stringify([
        version,
        sourceCacheKey(preparation.source),
        transformCacheKey(preparation.transform),
        preparation.parameters ?? null
    ]);
}

const OBJECT_IDS = new WeakMap();
let nextObjectId = 1;

function sourceCacheKey(source) {
    for (const key of ['contentHash', 'sha256', 'contentKey', 'cacheKey']) {
        const value = source?.[key];
        if ((typeof value === 'string' && value.length > 0) || typeof value === 'number') {
            return [key, value];
        }
    }
    return ['object', objectId(source)];
}

function transformCacheKey(transform) {
    const explicit = transform?.cacheKey;
    if ((typeof explicit === 'string' && explicit.length > 0) || typeof explicit === 'number') {
        return ['cacheKey', explicit];
    }
    const geometric = {};
    for (const key of ['scale', 'rotation', 'translation', 'matrix', 'config']) {
        if (transform?.[key] !== undefined) geometric[key] = serializable(transform[key]);
    }
    return Object.keys(geometric).length ? geometric : ['object', objectId(transform)];
}

function serializable(value) {
    if (ArrayBuffer.isView(value)) return Array.from(value);
    if (Array.isArray(value)) return value.map(serializable);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, serializable(child)]));
    }
    return value;
}

function objectId(value) {
    if (!value || typeof value !== 'object') return String(value);
    let id = OBJECT_IDS.get(value);
    if (id === undefined) {
        id = nextObjectId++;
        OBJECT_IDS.set(value, id);
    }
    return id;
}

function readClock(runtime) {
    const clock = runtime?.getClock?.() ?? 0;
    return Number.isFinite(clock) && clock >= 0 ? clock : 0;
}

async function releaseLateRuntime(runtime) {
    if (runtime?.returnToPreparation) await runtime.returnToPreparation();
    else await runtime?.dispose?.();
}

function isCancellation(error) {
    return error?.name === 'AbortError' || error?.name === 'SimulationCancelledError';
}

function message(error) {
    return error instanceof Error ? error.message : String(error);
}
