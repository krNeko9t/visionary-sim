/**
 * The PLY container, and nothing about Gaussians.
 *
 * This file knows how bytes are laid out; `cloud.js` knows what the numbers
 * mean. Keeping them apart is what lets a differently-encoded source (SOG, a
 * glTF extension) arrive later as a second reader feeding the same cloud.
 *
 * Only binary little-endian is read, which is what every 3DGS trainer emits.
 * ASCII PLY exists but nothing in this pipeline produces it, and a reader for a
 * format we never see is a claim the tree cannot back up.
 *
 * @typedef {object} PlyElement
 * @property {number} count - How many records the element holds.
 * @property {Record<string, Float32Array>} properties - One array per property,
 *   in the file's order, converted to float regardless of stored type.
 */

/** Bytes per PLY scalar type, by every spelling the format allows. */
const TYPE_SIZES = {
    char: 1, int8: 1, uchar: 1, uint8: 1,
    short: 2, int16: 2, ushort: 2, uint16: 2,
    int: 4, int32: 4, uint: 4, uint32: 4,
    float: 4, float32: 4,
    double: 8, float64: 8
};

/** How to pull each type out of a DataView. */
const TYPE_READERS = {
    char: (view, at) => view.getInt8(at),
    int8: (view, at) => view.getInt8(at),
    uchar: (view, at) => view.getUint8(at),
    uint8: (view, at) => view.getUint8(at),
    short: (view, at) => view.getInt16(at, true),
    int16: (view, at) => view.getInt16(at, true),
    ushort: (view, at) => view.getUint16(at, true),
    uint16: (view, at) => view.getUint16(at, true),
    int: (view, at) => view.getInt32(at, true),
    int32: (view, at) => view.getInt32(at, true),
    uint: (view, at) => view.getUint32(at, true),
    uint32: (view, at) => view.getUint32(at, true),
    float: (view, at) => view.getFloat32(at, true),
    float32: (view, at) => view.getFloat32(at, true),
    double: (view, at) => view.getFloat64(at, true),
    float64: (view, at) => view.getFloat64(at, true)
};

const MAGIC = 'ply';
const HEADER_END = 'end_header';

/**
 * Reads the first element of a binary PLY.
 *
 * Only the first element is read. Every 3DGS file puts its splats there and has
 * nothing after it; a file that does not is rejected rather than half-read,
 * because a list property downstream makes the record stride variable and there
 * would be no way to skip past it.
 *
 * @param {ArrayBuffer} buffer - The whole file.
 * @param {object} [options] - Reading options.
 * @param {string[]} [options.properties] - Names to keep. Everything else is
 *   still stepped over but not stored, which matters: the spherical harmonics
 *   are 45 floats per splat and nothing downstream reads them yet.
 * @returns {PlyElement} The element.
 */
export function readPly(buffer, { properties: wanted } = {}) {
    const { element, headerLength } = parseHeader(buffer);
    const keep = wanted ? new Set(wanted) : null;

    const missing = wanted?.filter(name => !element.properties.some(p => p.name === name)) ?? [];
    if (missing.length > 0) {
        throw new Error(`PLY element "${element.name}" has no property ${missing.join(', ')}`);
    }

    const stride = element.properties.reduce((total, { type }) => total + TYPE_SIZES[type], 0);
    const needed = headerLength + stride * element.count;
    if (buffer.byteLength < needed) {
        throw new Error(
            `PLY is truncated: ${element.count} records of ${stride} bytes need ` +
            `${needed} bytes, file has ${buffer.byteLength}`
        );
    }

    /** @type {Record<string, Float32Array>} */
    const out = {};
    const layout = [];
    let offset = 0;
    for (const { name, type } of element.properties) {
        if (!keep || keep.has(name)) {
            out[name] = new Float32Array(element.count);
            layout.push({ target: out[name], read: TYPE_READERS[type], offset });
        }
        offset += TYPE_SIZES[type];
    }

    const view = new DataView(buffer, headerLength);
    for (let i = 0; i < element.count; i++) {
        const base = i * stride;
        for (const { target, read, offset: at } of layout) {
            target[i] = read(view, base + at);
        }
    }

    return { count: element.count, properties: out };
}

/**
 * @param {ArrayBuffer} buffer - The whole file.
 * @returns {{ element: { name: string, count: number, properties: { name: string, type: string }[] }, headerLength: number }}
 *   The first element's declaration and where the binary body starts.
 */
function parseHeader(buffer) {
    // The header is ASCII and short; decoding a fixed prefix avoids walking a
    // 40 MB file to find a marker that is always near the front.
    const probe = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 64 * 1024));
    const text = new TextDecoder('ascii').decode(probe);
    const end = text.indexOf(HEADER_END);
    if (!text.startsWith(MAGIC) || end < 0) {
        throw new Error('not a PLY file: no "ply" magic or no end_header in the first 64 KB');
    }

    const terminator = text.indexOf('\n', end) + 1;
    const lines = text.slice(0, end).split(/\r?\n/).map(line => line.trim()).filter(Boolean);

    const format = lines.find(line => line.startsWith('format '));
    if (format !== 'format binary_little_endian 1.0') {
        throw new Error(`unsupported PLY format "${format}"; only binary_little_endian 1.0 is read`);
    }

    let element = null;
    for (const line of lines) {
        const [keyword, ...rest] = line.split(/\s+/);
        if (keyword === 'element') {
            if (element) {
                break; // Only the first element is read; see the doc comment.
            }
            element = { name: rest[0], count: Number(rest[1]), properties: [] };
        } else if (keyword === 'property' && element) {
            if (rest[0] === 'list') {
                throw new Error(`PLY element "${element.name}" has a list property, which this reader cannot stride past`);
            }
            if (!(rest[0] in TYPE_SIZES)) {
                throw new Error(`unknown PLY property type "${rest[0]}"`);
            }
            element.properties.push({ type: rest[0], name: rest[1] });
        }
    }

    if (!element || !(element.count >= 0)) {
        throw new Error('PLY header declares no usable element');
    }
    return { element, headerLength: terminator };
}
