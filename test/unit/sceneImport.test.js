import { describe, expect, it } from 'vitest';

import { parseNpy } from '../../src/app/import/npy.js';
import { readNpz } from '../../src/app/import/npz.js';
import { prepareSceneImport } from '../../src/app/import/prepareScene.js';

const PLY_FIELDS = [
    'x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity',
    'scale_0', 'scale_1', 'rot_0', 'rot_1', 'rot_2', 'rot_3',
    ...Array.from({ length: 45 }, (_, i) => `f_rest_${i}`)
];

// NumPy 2.4.0: save(BytesIO(), labels=np.array([0, 1, 1], dtype='<i4')).
// Both writers use local ZIP64 sizes even though their central directory is ZIP32.
const NUMPY_ARCHIVES = {
    savez: 'UEsDBC0AAAAAAAAAIQDsQwi7//////////8KABQAbGFiZWxzLm5weQEAEACMAAAAAAAAAIwAAAAAAAAAk05VTVBZAQB2AHsnZGVzY3InOiAnPGk0JywgJ2ZvcnRyYW5fb3JkZXInOiBGYWxzZSwgJ3NoYXBlJzogKDMsKSwgfSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAoAAAAAAQAAAAEAAABQSwECLQMtAAAAAAAAACEA7EMIu4wAAACMAAAACgAAAAAAAAAAAAAAgAEAAAAAbGFiZWxzLm5weVBLBQYAAAAAAQABADgAAADIAAAAAAA=',
    savez_compressed: 'UEsDBC0AAAAIAAAAIQDsQwi7//////////8KABQAbGFiZWxzLm5weQEAEACMAAAAAAAAAEkAAAAAAAAAm+wX6hsQychQxlCtnpJanFykbqWgbpNpoq6joJ6WX1RSlJgXn1+UkgoSd0vMKU4FihdnJBakAvkaxjqaOgq1ChQALgYgYIRiAFBLAQItAy0AAAAIAAAAIQDsQwi7SQAAAIwAAAAKAAAAAAAAAAAAAACAAQAAAABsYWJlbHMubnB5UEsFBgAAAAABAAEAOAAAAIUAAAAAAA=='
};

function numpyArchive(name = 'savez') {
    return Uint8Array.from(atob(NUMPY_ARCHIVES[name]), char => char.charCodeAt(0));
}

function npy(descr, shape, values) {
    const shapeText = shape.length === 0 ? '()' : `(${shape.join(', ')}${shape.length === 1 ? ',' : ''})`;
    let header = `{'descr': '${descr}', 'fortran_order': False, 'shape': ${shapeText}, }`;
    const prefix = 10;
    header += ' '.repeat((16 - ((prefix + header.length + 1) % 16)) % 16) + '\n';
    const body = values instanceof Uint8Array ? values : new Uint8Array(values.buffer);
    const out = new Uint8Array(prefix + header.length + body.byteLength);
    out.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0]);
    new DataView(out.buffer).setUint16(8, header.length, true);
    out.set(new TextEncoder().encode(header), prefix);
    out.set(body, prefix + header.length);
    return out;
}

function unicodeScalar(text, width = 100) {
    const bytes = new Uint8Array(width * 4);
    const view = new DataView(bytes.buffer);
    [...text].forEach((char, i) => view.setUint32(i * 4, char.codePointAt(0), true));
    return npy(`<U${width}`, [], bytes);
}

function storedNpz(entries) {
    const encoder = new TextEncoder();
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const [name, data] of Object.entries(entries)) {
        const nameBytes = encoder.encode(name);
        const local = new Uint8Array(30 + nameBytes.length + data.length);
        const lv = new DataView(local.buffer);
        lv.setUint32(0, 0x04034b50, true);
        lv.setUint16(4, 20, true);
        lv.setUint16(8, 0, true);
        lv.setUint32(14, crc32(data), true);
        lv.setUint32(18, data.length, true);
        lv.setUint32(22, data.length, true);
        lv.setUint16(26, nameBytes.length, true);
        local.set(nameBytes, 30);
        local.set(data, 30 + nameBytes.length);

        const central = new Uint8Array(46 + nameBytes.length);
        const cv = new DataView(central.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(10, 0, true);
        cv.setUint32(16, crc32(data), true);
        cv.setUint32(20, data.length, true);
        cv.setUint32(24, data.length, true);
        cv.setUint16(28, nameBytes.length, true);
        cv.setUint32(42, offset, true);
        central.set(nameBytes, 46);
        locals.push(local);
        centrals.push(central);
        offset += local.length;
    }
    const centralOffset = offset;
    const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, centrals.length, true);
    ev.setUint16(10, centrals.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, centralOffset, true);
    const out = new Uint8Array(centralOffset + centralSize + end.length);
    let at = 0;
    for (const part of [...locals, ...centrals, end]) {
        out.set(part, at);
        at += part.length;
    }
    return out.buffer;
}

function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function ply(rows) {
    const header = [
        'ply', 'format binary_little_endian 1.0', `element vertex ${rows.length}`,
        ...PLY_FIELDS.map(name => `property float ${name}`), 'end_header', ''
    ].join('\n');
    const head = new TextEncoder().encode(header);
    const body = new Float32Array(rows.length * PLY_FIELDS.length);
    rows.forEach((row, i) => PLY_FIELDS.forEach((name, j) => {
        body[i * PLY_FIELDS.length + j] = row[name] ?? (name === 'rot_0' ? 1 : 0);
    }));
    const out = new Uint8Array(head.length + body.byteLength);
    out.set(head);
    out.set(new Uint8Array(body.buffer), head.length);
    return out.buffer;
}

function inputs({ labels = [0, 1, 1], valid = [0, 1, 1], physics, rows = [
        { x: -2, y: 0, z: 4, scale_0: 0, scale_1: Math.log(2), f_rest_44: 44 },
        { x: 2, y: 1, z: 5, scale_0: Math.log(3), scale_1: 0, f_rest_44: 45 },
        { x: 0, y: 2, z: 6, scale_0: 0, scale_1: 0, f_rest_44: 46 }
    ] } = {}) {
    return {
        geometryBuffer: ply(rows),
        labelsBuffer: storedNpz({
            'labels.npy': npy('<i4', [labels.length], Int32Array.from(labels)),
            'valid.npy': npy('|b1', [valid.length], Uint8Array.from(valid)),
            'params.npy': unicodeScalar('{"source":"bench"}')
        }),
        physicsText: JSON.stringify(physics ?? {
            meta: { names: { 1: 'thing' } },
            rows: [{ instance_id: 1, n_gau: 2, E_si: 1000, nu_si: 0.3 }]
        })
    };
}

describe('scene import bytes', () => {
    it.each(Object.keys(NUMPY_ARCHIVES))('reads actual NumPy %s local ZIP64 entries', async name => {
        const archive = await readNpz(numpyArchive(name));
        expect(archive.get('labels').data).toEqual(Int32Array.from([0, 1, 1]));
    });

    it.each([
        ['missing ZIP64', view => view.setUint16(40, 2, true), 'ZIP64'],
        ['truncated ZIP64', view => view.setUint16(42, 8, true), 'ZIP64'],
        ['oversized extra', view => view.setUint16(42, 30, true), 'extra'],
        ['size mismatch', view => view.setBigUint64(44, 139n, true), '大小/CRC'],
        ['compressed mismatch', view => view.setBigUint64(52, 139n, true), '大小/CRC'],
        ['unsafe integer', view => view.setBigUint64(44, 1n << 60n, true), '大小/CRC'],
        ['local CRC mismatch', view => view.setUint32(14, 0, true), '大小/CRC'],
        ['payload corruption', view => view.setUint8(199, 7), 'CRC']
    ])('rejects damaged NumPy ZIP64: %s', async (_name, mutate, message) => {
        const bytes = numpyArchive();
        mutate(new DataView(bytes.buffer));
        await expect(readNpz(bytes)).rejects.toThrow(message);
    });

    it('accepts the upstream Unicode params scalar without confusing it for a required array', async () => {
        const archive = await readNpz(inputs().labelsBuffer);
        expect(archive.get('params').data).toBe('{"source":"bench"}');
        expect(parseNpy(npy('<i4', [2], Int32Array.from([7, 9]))).data).toEqual(Int32Array.from([7, 9]));
    });

    it('rejects a local ZIP header that contradicts the central directory', async () => {
        const buffer = inputs().labelsBuffer;
        new DataView(buffer).setUint16(8, 8, true);
        await expect(readNpz(buffer)).rejects.toThrow('local header 与中央目录不一致');
    });

    it('keeps every raw row and directional coefficient while reporting an instance material gap', async () => {
        const scene = await prepareSceneImport(inputs());
        expect(scene.count).toBe(3);
        expect(scene.reference).toEqual({ center: [0, 1, 5], longestSide: 4, defaultMeters: 1 });
        expect(scene.groups.map(group => [group.id, group.count])).toEqual([[0, 1], [1, 2]]);
        expect([...scene.groups[0].rawRows]).toEqual([0]);
        expect([...scene.groups[1].rawRows]).toEqual([1, 2]);
        expect(scene.groups[1].cloud.dimensionality).toBe(2);
        expect([...scene.groups[1].cloud.scales]).toEqual([3, 1, 0, 1, 1, 0]);
        expect([...scene.groups[1].cloud.sphericalHarmonics[44]]).toEqual([45, 46]);
        expect(scene.instances[0].material.valid).toBe(false);
        expect(scene.instances[0].material.issues).toContain('缺少 rho_si');
        expect(scene.simulationBodies).toBe(0);
    });

    it.each([
        ['labels length', { labels: [0, 1] }, 'labels.npy: 数组长度 2 与 PLY 原始行数 3 不一致'],
        ['valid relation', { valid: [0, 0, 1] }, 'valid.npy: 第 1 行与 labels > 0 的关系矛盾'],
        ['duplicate id', { physics: { rows: [
            { instance_id: 1, n_gau: 2 }, { instance_id: 1, n_gau: 2 }
        ] } }, 'instance_physics.json: instance_id 1 重复'],
        ['count mismatch', { physics: { rows: [{ instance_id: 1, n_gau: 7 }] } }, 'instance_physics.json: instance_id 1 的 n_gau=7，与标签计数 2 不一致']
    ])('rejects a structural contradiction: %s', async (_name, changes, message) => {
        await expect(prepareSceneImport(inputs(changes))).rejects.toThrow(message);
    });

    it('rejects non-renderable numeric geometry instead of silently repairing it', async () => {
        const broken = [
            { x: -2, y: 0, z: 4, rot_0: 0 },
            { x: 2, y: 1, z: 5 },
            { x: 0, y: 2, z: 6 }
        ];
        await expect(prepareSceneImport(inputs({ rows: broken }))).rejects.toThrow('第 0 行 rotation 为零四元数');
    });
});
