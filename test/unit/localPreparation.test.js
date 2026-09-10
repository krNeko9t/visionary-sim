import { describe, expect, it } from 'vitest';

import { LOCAL_PREPARATION_KEY, createLocalPreparationStore } from '../../src/app/localPreparation.js';

function memoryStorage() {
    const records = new Map();
    return {
        getItem: key => records.get(key) ?? null,
        setItem: (key, value) => records.set(key, String(value))
    };
}

function validPreparation() {
    const sha256 = 'a'.repeat(64);
    return {
        formatVersion: 1,
        sources: {
            geometry: { name: 'scene.npy', sha256 },
            labels: { name: 'labels.npy', sha256 },
            physics: { name: 'physics.npz', sha256 }
        },
        calibration: { upAxis: '+Y', manualDegrees: [0, 0, 0], longestMeters: 2, position: [0, 1, 0] },
        container: { position: [0, 1, 0], orientation: [0, 0, 0, 1], dimensions: [3, 4, 5] },
        materialOverrides: { 7: { density: 900 } },
        participantIds: [7]
    };
}

describe('local preparation persistence', () => {
    it('stores only the validator result and reads it as preparation awaiting source files', () => {
        const storage = memoryStorage();
        const validate = value => ({
            formatVersion: value.formatVersion,
            selectedInstanceIds: [...value.selectedInstanceIds]
        });
        const local = createLocalPreparationStore({ storage, validate });
        const editing = {
            formatVersion: 1,
            selectedInstanceIds: [7, 12],
            sourceFiles: [{ name: 'large.npy', bytes: new Uint8Array([1, 2, 3]) }],
            running: { deformation: [4, 5, 6], velocity: [7, 8, 9] },
            derivedCache: { voxels: [10, 11] }
        };

        expect(local.save(editing)).toMatchObject({ status: 'saved' });
        expect(local.read()).toEqual({
            status: 'loaded',
            config: { formatVersion: 1, selectedInstanceIds: [7, 12] },
            message: '已读取浏览器中的准备配置；请重新选择三个源文件。',
            requiresSourceFiles: true,
            autoStart: false
        });
    });

    it('uses the shared preparation schema when no validator override is provided', () => {
        const local = createLocalPreparationStore({ storage: memoryStorage() });

        expect(local.save(validPreparation())).toMatchObject({ status: 'saved' });
        expect(local.read()).toMatchObject({
            status: 'loaded',
            config: validPreparation(),
            requiresSourceFiles: true,
            autoStart: false
        });
    });

    it('reports a quota or permission failure while leaving the editable configuration intact', () => {
        const editing = Object.freeze({ formatVersion: 1, selectedInstanceIds: Object.freeze([4]) });
        const storage = {
            getItem: () => null,
            setItem() {
                const error = new Error('quota denied');
                error.name = 'QuotaExceededError';
                throw error;
            }
        };
        const local = createLocalPreparationStore({ storage, validate: value => value });

        expect(local.save(editing)).toEqual({
            status: 'failed',
            code: 'storage-write-failed',
            message: '浏览器未能保存准备配置。当前编辑仍保留；请导出 JSON 作为恢复副本。',
            canExport: true,
            detail: 'quota denied'
        });
        expect(editing).toEqual({ formatVersion: 1, selectedInstanceIds: [4] });
    });

    it('does not report success when a storage write cannot be read back', () => {
        const local = createLocalPreparationStore({
            storage: { setItem() {}, getItem: () => null },
            validate: value => value
        });

        expect(local.save({ formatVersion: 1 })).toMatchObject({
            status: 'failed',
            code: 'storage-write-failed',
            canExport: true
        });
    });

    it('reports an empty browser record without claiming that data can be recovered', () => {
        const local = createLocalPreparationStore({ storage: memoryStorage(), validate: value => value });

        expect(local.read()).toEqual({
            status: 'empty',
            message: '此浏览器没有已保存的准备配置；可导入此前导出的 JSON。',
            canImport: true
        });
    });

    it('reports a blocked read without changing the current in-memory edit', () => {
        const currentEdit = { calibration: { longestMeters: 2.5 } };
        const local = createLocalPreparationStore({
            storage: {
                setItem() {},
                getItem() { throw new Error('storage permission denied'); }
            },
            validate: value => value
        });

        expect(local.read()).toEqual({
            status: 'failed',
            code: 'storage-read-failed',
            message: '浏览器未能读取准备配置。当前编辑未更改；可导入此前导出的 JSON。',
            canExport: true,
            canImport: true,
            detail: 'storage permission denied'
        });
        expect(currentEdit).toEqual({ calibration: { longestMeters: 2.5 } });
    });

    it.each([
        ['malformed JSON', '{broken', value => value],
        ['unsupported configuration', '{"formatVersion":99}', () => { throw new Error('unsupported version 99'); }]
    ])('rejects a %s browser record without partially applying it', (_case, record, validate) => {
        const storage = memoryStorage();
        storage.setItem(LOCAL_PREPARATION_KEY, record);
        const local = createLocalPreparationStore({ storage, validate });

        const result = local.read();
        expect(result).toMatchObject({
            status: 'failed',
            code: 'saved-configuration-invalid',
            message: '浏览器中的准备配置已损坏或不受支持。当前编辑未更改；可导入此前导出的 JSON。',
            canExport: true,
            canImport: true
        });
        expect(result.detail).toEqual(expect.any(String));
        expect(result).not.toHaveProperty('config');
    });
});
