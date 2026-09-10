import { describe, expect, it } from 'vitest';

import {
    PREPARATION_CONFIG_VERSION,
    createPreparationConfig,
    fingerprintSourceFiles,
    fingerprintSourceBuffers,
    matchPreparationSources,
    parsePreparationConfig,
    validatePreparationConfig
} from '../../src/app/preparationConfig.js';

const sha256 = {
    geometry: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    labels: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    physics: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
};

const fingerprints = (names = {}) => ({
    geometry: { name: names.geometry ?? 'point_cloud.ply', sha256: sha256.geometry },
    labels: { name: names.labels ?? 'labels.npz', sha256: sha256.labels },
    physics: { name: names.physics ?? 'instance_physics.json', sha256: sha256.physics }
});

const input = (patch = {}) => ({
    sources: fingerprints(),
    calibration: {
        upAxis: '+Z',
        manualDegrees: [10, -20, 30],
        longestMeters: 1.5,
        position: [1, 2, 3]
    },
    container: {
        position: [0.25, 0.5, 0.75],
        orientation: [0, 0, 0, 1],
        dimensions: [2, 3, 4]
    },
    materialOverrides: {
        7: { density: 950 },
        42: { youngsModulus: 2.5e6, poissonRatio: 0.32 }
    },
    participantIds: [42, 7],
    instanceIds: [7, 42],
    ...patch
});

describe('portable preparation configuration', () => {
    it('uses the same digest for already-read worker bytes without transferring source bytes back', async () => {
        const buffers = Object.fromEntries(['geometry', 'labels', 'physics'].map(slot =>
            [slot, { name: slot, bytes: new TextEncoder().encode('abc').buffer }]));
        const sources = await fingerprintSourceBuffers(buffers);
        for (const source of Object.values(sources)) {
            expect(source.sha256).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
            expect(Object.keys(source)).toEqual(['name', 'sha256']);
        }
        expect(new TextDecoder().decode(buffers.geometry.bytes)).toBe('abc');
    });
    it('fingerprints the complete bytes of all three source slots', async () => {
        const files = {
            geometry: new File(['abc'], 'renamed.ply'),
            labels: new File([Uint8Array.from([0, 1, 2, 255])], 'labels-copy.npz'),
            physics: new File(['{"rows":[]}'], 'physics-copy.json')
        };

        await expect(fingerprintSourceFiles(files)).resolves.toEqual({
            geometry: {
                name: 'renamed.ply',
                sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
            },
            labels: {
                name: 'labels-copy.npz',
                sha256: '3d1f57c984978ef98a18378c8166c1cb8ede02c03eeb6aee7e2f121dfeee3e56'
            },
            physics: {
                name: 'physics-copy.json',
                sha256: '1633902c6cbba5e7770dbed172df754a25078bb76efe1f23474edc87f1a47655'
            }
        });
    });

    it('creates a lightweight canonical configuration from authored preparation state', () => {
        const config = createPreparationConfig(input());

        expect(config).toEqual({
            formatVersion: PREPARATION_CONFIG_VERSION,
            sources: fingerprints(),
            calibration: {
                upAxis: '+Z',
                manualDegrees: [10, -20, 30],
                longestMeters: 1.5,
                position: [1, 2, 3]
            },
            container: {
                position: [0.25, 0.5, 0.75],
                orientation: [0, 0, 0, 1],
                dimensions: [2, 3, 4]
            },
            materialOverrides: {
                7: { density: 950 },
                42: { youngsModulus: 2.5e6, poissonRatio: 0.32 }
            },
            participantIds: [42, 7]
        });
        expect(JSON.stringify(config)).not.toMatch(/velocity|deformation|bodyId|sourceContent|runtime/i);
        expect(Object.isFrozen(config)).toBe(true);
    });

    it('parses only the supported strict format and validates source instance references', () => {
        const config = createPreparationConfig(input());

        expect(validatePreparationConfig(config, { instanceIds: [42, 7] })).toEqual(config);
        expect(parsePreparationConfig(JSON.stringify(config), { instanceIds: [42, 7] })).toEqual(config);
        expect(() => parsePreparationConfig('{not json')).toThrow(/JSON/);
        expect(() => parsePreparationConfig(JSON.stringify({ ...config, formatVersion: 99 })))
            .toThrow(/unsupported preparation configuration version 99/i);
        expect(() => parsePreparationConfig(JSON.stringify({ ...config, running: true })))
            .toThrow(/unknown field "running"/i);
        expect(() => parsePreparationConfig(JSON.stringify(config), { instanceIds: [7] }))
            .toThrow(/instance ID 42.*current source/i);
    });

    it('rejects corrupt geometry, material values and references without normalizing them', () => {
        expect(() => createPreparationConfig(input({
            calibration: { ...input().calibration, position: [0, Infinity, 0] }
        }))).toThrow(/calibration position.*finite/i);
        expect(() => createPreparationConfig(input({
            container: { ...input().container, dimensions: [1, 0, 1] }
        }))).toThrow(/container dimensions.*positive finite/i);
        expect(() => createPreparationConfig(input({
            container: { ...input().container, orientation: [0, 0, 0, 2] }
        }))).toThrow(/unit quaternion/i);
        expect(() => createPreparationConfig(input({
            materialOverrides: { 7: { density: NaN } }
        }))).toThrow(/density.*positive finite/i);
        expect(() => createPreparationConfig(input({
            materialOverrides: { 7: { poissonRatio: 0.9 } }
        }))).toThrow(/poissonRatio.*0.25.*0.49/i);
        expect(() => createPreparationConfig(input({ participantIds: [7, 7] })))
            .toThrow(/duplicate participant instance ID 7/i);
        expect(() => createPreparationConfig(input({ materialOverrides: { 0: { density: 1 } } })))
            .toThrow(/positive instance ID/i);
    });

    it('requires exact schemas at every level', () => {
        expect(() => validatePreparationConfig({ ...createPreparationConfig(input()),
            calibration: { ...input().calibration, position: new Array(3) } })).toThrow(/finite/);
        expect(() => validatePreparationConfig({ ...createPreparationConfig(input()),
            participantIds: new Array(1) })).toThrow(/positive safe integer/);
        expect(() => validatePreparationConfig({ ...createPreparationConfig(input()),
            materialOverrides: new Map() })).toThrow(/object/);
        expect(() => createPreparationConfig(input({
            sources: { ...fingerprints(), geometry: { ...fingerprints().geometry, size: 3 } }
        }))).toThrow(/unknown field "size"/i);
        expect(() => createPreparationConfig(input({
            calibration: { ...input().calibration, scale: 1 }
        }))).toThrow(/unknown field "scale"/i);
        expect(() => createPreparationConfig(input({
            materialOverrides: { 7: { density: 900, trust: 'high' } }
        }))).toThrow(/unknown field "trust"/i);
    });

    it('matches renamed files by content alone and rejects any changed slot', async () => {
        const files = {
            geometry: new File(['geometry'], 'point_cloud.ply'),
            labels: new File(['labels'], 'labels.npz'),
            physics: new File(['physics'], 'instance_physics.json')
        };
        const saved = createPreparationConfig({
            ...input(),
            sources: await fingerprintSourceFiles(files)
        });
        const renamed = {
            geometry: new File(['geometry'], 'moved-and-renamed.ply'),
            labels: new File(['labels'], 'renamed-labels.npz'),
            physics: new File(['physics'], 'renamed-physics.json')
        };

        await expect(matchPreparationSources(saved, renamed, { instanceIds: [7, 42] }))
            .resolves.toMatchObject({ matched: true });
        await expect(matchPreparationSources(saved, {
            ...renamed,
            labels: new File(['labelS'], 'labels.npz')
        }, { instanceIds: [7, 42] })).resolves.toEqual({
            matched: false,
            mismatchedSlots: ['labels']
        });
    });
});
