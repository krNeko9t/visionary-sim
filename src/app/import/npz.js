import { parseNpy } from './npy.js';

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** Validate NPY entries with a ZIP32 directory, including NumPy local ZIP64 sizes. */
export async function readNpz(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const end = findEnd(view);
    const disk = u16(view, end + 4, 'NPZ end record');
    const centralDisk = u16(view, end + 6, 'NPZ end record');
    const diskEntries = u16(view, end + 8, 'NPZ end record');
    const entryCount = u16(view, end + 10, 'NPZ end record');
    const centralSize = u32(view, end + 12, 'NPZ end record');
    const centralOffset = u32(view, end + 16, 'NPZ end record');
    if (disk !== 0 || centralDisk !== 0 || diskEntries !== entryCount) throw new Error('labels.npz: 不支持分卷 ZIP');
    if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
        throw new Error('labels.npz: 不支持 ZIP64');
    }
    if (centralOffset + centralSize > end) throw new Error('labels.npz: ZIP 中央目录范围损坏');
    const result = new Map();
    let at = centralOffset;
    for (let index = 0; index < entryCount; index++) {
        if (u32(view, at, 'NPZ central directory') !== CENTRAL) throw new Error('labels.npz: ZIP 中央目录损坏');
        const flags = u16(view, at + 8, 'NPZ central directory');
        const method = u16(view, at + 10, 'NPZ central directory');
        const crc = u32(view, at + 16, 'NPZ central directory');
        const compressedSize = u32(view, at + 20, 'NPZ central directory');
        const size = u32(view, at + 24, 'NPZ central directory');
        const nameLength = u16(view, at + 28, 'NPZ central directory');
        const extraLength = u16(view, at + 30, 'NPZ central directory');
        const commentLength = u16(view, at + 32, 'NPZ central directory');
        const localOffset = u32(view, at + 42, 'NPZ central directory');
        const next = at + 46 + nameLength + extraLength + commentLength;
        if (next > centralOffset + centralSize) throw new Error('labels.npz: ZIP 中央目录条目被截断');
        if (flags & 1) throw new Error('labels.npz: 不支持加密 ZIP 条目');
        const nameBytes = bytes.subarray(at + 46, at + 46 + nameLength);
        const name = new TextDecoder(flags & 0x800 ? 'utf-8' : 'ascii', { fatal: true }).decode(nameBytes);
        if (!name.endsWith('/')) {
            if (!name.endsWith('.npy')) throw new Error(`labels.npz: 非 NPY 条目 ${name}`);
            const key = name.slice(0, -4);
            if (result.has(key)) throw new Error(`labels.npz: 重复条目 ${name}`);
            const data = await readEntry(bytes, view, { name, nameBytes, flags, method, crc, compressedSize, size, localOffset, centralOffset });
            result.set(key, parseNpy(data, `labels.npz/${name}`));
        }
        at = next;
    }
    if (at !== centralOffset + centralSize) throw new Error('labels.npz: ZIP 中央目录大小不一致');
    return result;
}

function findEnd(view) {
    for (let at = view.byteLength - 22; at >= Math.max(0, view.byteLength - 65557); at--) {
        if (view.getUint32(at, true) === EOCD) {
            const commentLength = u16(view, at + 20, 'NPZ end record');
            if (at + 22 + commentLength === view.byteLength) return at;
        }
    }
    throw new Error('labels.npz: 缺少 ZIP end record');
}

async function readEntry(bytes, view, entry) {
    const { name, nameBytes, flags, method, crc, compressedSize, size, localOffset, centralOffset } = entry;
    if (localOffset >= centralOffset) throw new Error(`labels.npz/${name}: local header 不在数据区`);
    if (u32(view, localOffset, `labels.npz/${name}`) !== LOCAL) throw new Error(`labels.npz/${name}: local header 损坏`);
    const localFlags = u16(view, localOffset + 6, name);
    const localMethod = u16(view, localOffset + 8, name);
    const nameLength = u16(view, localOffset + 26, name);
    const extraLength = u16(view, localOffset + 28, name);
    if (localFlags !== flags || localMethod !== method) throw new Error(`labels.npz/${name}: local header 与中央目录不一致`);
    if (localOffset + 30 + nameLength + extraLength > bytes.length) throw new Error(`labels.npz/${name}: local header 被截断`);
    const localName = bytes.subarray(localOffset + 30, localOffset + 30 + nameLength);
    if (localName.length !== nameBytes.length || localName.some((value, i) => value !== nameBytes[i])) {
        throw new Error(`labels.npz/${name}: local 文件名与中央目录不一致`);
    }
    const start = localOffset + 30 + nameLength + extraLength;
    if (start + compressedSize > centralOffset) throw new Error(`labels.npz/${name}: 压缩数据被截断或越过中央目录`);
    if (!(flags & 0x08)) {
        const localCrc = u32(view, localOffset + 14, name);
        const [localSize, localCompressed] = localSizes(view, localOffset, nameLength, extraLength, name);
        if (localCrc !== crc || localCompressed !== BigInt(compressedSize) || localSize !== BigInt(size)) {
            throw new Error(`labels.npz/${name}: local 大小/CRC 与中央目录不一致`);
        }
    }
    const compressed = bytes.slice(start, start + compressedSize);
    let data;
    if (method === 0) data = compressed;
    else if (method === 8) {
        if (typeof DecompressionStream !== 'function') throw new Error('labels.npz: 浏览器缺少 deflate-raw 解压能力');
        const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        data = new Uint8Array(await new Response(stream).arrayBuffer());
    } else throw new Error(`labels.npz/${name}: 不支持 ZIP 压缩方式 ${method}`);
    if (data.length !== size) throw new Error(`labels.npz/${name}: 解压大小 ${data.length} 与目录 ${size} 不一致`);
    if (crc32(data) !== crc) throw new Error(`labels.npz/${name}: CRC 校验失败`);
    return data;
}

function localSizes(view, offset, nameLength, extraLength, name) {
    const size = u32(view, offset + 22, name);
    const compressed = u32(view, offset + 18, name);
    const sizes = [BigInt(size), BigInt(compressed)];
    const needs64 = [size === 0xffffffff, compressed === 0xffffffff];
    let at = offset + 30 + nameLength;
    const end = at + extraLength;
    let found64 = false;
    while (at < end) {
        if (at + 4 > end) throw new Error(`labels.npz/${name}: local extra 被截断`);
        const id = u16(view, at, name);
        const length = u16(view, at + 2, name);
        at += 4;
        if (at + length > end) throw new Error(`labels.npz/${name}: local extra 被截断`);
        if (id === 1) {
            if (found64) throw new Error(`labels.npz/${name}: 重复 local ZIP64 extra`);
            found64 = true;
            let cursor = at;
            for (let i = 0; i < sizes.length; i++) {
                if (!needs64[i]) continue;
                if (cursor + 8 > at + length) throw new Error(`labels.npz/${name}: local ZIP64 大小被截断`);
                sizes[i] = view.getBigUint64(cursor, true);
                cursor += 8;
            }
        }
        at += length;
    }
    if (needs64.some(Boolean) && !found64) throw new Error(`labels.npz/${name}: 缺少 local ZIP64 大小`);
    return sizes;
}

function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function u16(view, at, context) {
    if (at < 0 || at + 2 > view.byteLength) throw new Error(`${context}: 数据被截断`);
    return view.getUint16(at, true);
}

function u32(view, at, context) {
    if (at < 0 || at + 4 > view.byteLength) throw new Error(`${context}: 数据被截断`);
    return view.getUint32(at, true);
}
