import { expect, it } from 'vitest';
import { createLocalSceneConfiguration } from '../../src/app/localSceneConfiguration.js';
import { createSceneConfiguration } from '../../src/app/sceneConfiguration.js';

function fixture() {
    const records = new Map();
    const storage = { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) };
    const sha256 = 'a'.repeat(64);
    const config = {
        formatVersion: 1,
        sources: Object.fromEntries(['geometry', 'labels', 'physics'].map(slot => [slot, { name: slot, sha256 }])),
        calibration: { upAxis: '+Y', manualDegrees: [0, 0, 0], longestMeters: 2, position: [0, 0, 0] },
        container: { position: [0, 0, 0], orientation: [0, 0, 0, 1], dimensions: [3, 3, 3] },
        materialOverrides: { 7: { density: 900 } }, participantIds: [7]
    };
    let pending = null;
    const configuration = {
        exportConfiguration: () => config,
        importConfiguration: value => { pending = value; },
        getState: () => ({ pending })
    };
    return { storage, config, configuration };
}

it('manually saves then hands a reopened record to pending source association', async () => {
    const f = fixture();
    const local = createLocalSceneConfiguration(f.configuration, { storage: f.storage });
    expect((await local.saveLocal()).status).toBe('saved');
    const reopened = createLocalSceneConfiguration(f.configuration, { storage: f.storage });
    expect((await reopened.loadLocal()).status).toBe('loaded');
    expect(f.configuration.getState().pending).toEqual(f.config);
    expect(reopened.getState().autoStart).toBe(false);
});

it.each(['QuotaExceededError', 'SecurityError'])('retains edits and the previous record after %s', async name => {
    const f = fixture();
    const local = createLocalSceneConfiguration(f.configuration, { storage: f.storage });
    await local.saveLocal();
    f.config.participantIds = [7, 9];
    f.storage.setItem = () => { throw Object.assign(new Error('denied'), { name }); };
    expect(await local.saveLocal()).toMatchObject({ status: 'failed', canExport: true });
    expect(f.config.participantIds).toEqual([7, 9]);
    await local.loadLocal();
    expect(f.configuration.getState().pending.participantIds).toEqual([7]);
});

it.each(['empty', 'corrupt', 'denied'])('does not import an %s record', async kind => {
    const f = fixture();
    f.storage.getItem = () => {
        if (kind === 'denied') throw new Error('permission denied');
        return kind === 'empty' ? null : '{broken';
    };
    const local = createLocalSceneConfiguration(f.configuration, { storage: f.storage });
    expect((await local.loadLocal()).status).toBe(kind === 'empty' ? 'empty' : 'failed');
    expect(f.configuration.getState().pending).toBe(null);
    expect(local.getState().canImport).toBe(true);
});

it('publishes success only after export and storage verification and rejects overlapping operations', async () => {
    const f = fixture();
    let finish;
    f.configuration.exportConfiguration = () => new Promise(resolve => { finish = resolve; });
    const local = createLocalSceneConfiguration(f.configuration, { storage: f.storage });
    const observed = [];
    local.subscribe(state => observed.push(state.status));
    const saving = local.saveLocal();
    expect(local.getState()).toMatchObject({ status: 'saving', busy: true });
    expect(await local.loadLocal()).toMatchObject({ code: 'busy' });
    expect(observed).not.toContain('saved');
    finish(f.config);
    await saving;
    expect(observed).toEqual(['idle', 'saving', 'saved']);
});

it('reports invalid export and rejected import without a success notification', async () => {
    const f = fixture();
    const local = createLocalSceneConfiguration(f.configuration, { storage: f.storage });
    await local.saveLocal();
    f.configuration.importConfiguration = () => { throw new Error('invalid references'); };
    expect(await local.loadLocal()).toMatchObject({ status: 'failed', detail: 'invalid references' });
    f.config.runtime = { velocity: [1, 2, 3] };
    expect(await local.saveLocal()).toMatchObject({ status: 'failed', canExport: true });
    expect(f.configuration.getState().pending).toBe(null);
});

it('does not write after disposal while an export is pending', async () => {
    const f = fixture();
    let finish;
    f.configuration.exportConfiguration = () => new Promise(resolve => { finish = resolve; });
    const local = createLocalSceneConfiguration(f.configuration, { storage: f.storage });
    const saving = local.saveLocal();
    local.dispose();
    finish(f.config);
    expect((await saving).status).toBe('failed');
    const reopened = createLocalSceneConfiguration(f.configuration, { storage: f.storage });
    expect((await reopened.loadLocal()).status).toBe('empty');
});

it('restores through the real portable controller after reselecting sources and stays in preparation', async () => {
    const f = fixture();
    const first = createSceneConfiguration({ readConfiguration: () => f.config });
    await createLocalSceneConfiguration(first, { storage: f.storage }).saveLocal();
    first.dispose();
    let application = { phase: 'empty', config: null };
    const reopened = createSceneConfiguration({
        readConfiguration: () => application.config,
        async prepareImport() {
            let staged;
            return {
                sources: f.config.sources,
                instanceIds: [7],
                prepareConfiguration(config) { staged = config; },
                commit() { application = { phase: 'preparation', config: staged }; },
                dispose() {}
            };
        }
    });
    const local = createLocalSceneConfiguration(reopened, { storage: f.storage });
    await local.loadLocal();
    expect(reopened.getState().status).toBe('awaiting-sources');
    expect(application.phase).toBe('empty');
    await reopened.associateSources({});
    expect(reopened.getState().status).toBe('restored');
    expect(application).toEqual({ phase: 'preparation', config: f.config });
    local.dispose();
    reopened.dispose();
});
