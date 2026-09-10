const MAGIC = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59];
const HOST_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/** Decode a non-object NPY array and validate its complete payload. */
export function parseNpy(input, source = 'NPY') {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.length < 10 || MAGIC.some((value, i) => bytes[i] !== value)) {
        throw new Error(`${source}: 缺少 NPY magic`);
    }
    const major = bytes[6];
    const minor = bytes[7];
    if (!((major === 1 && minor === 0) || ((major === 2 || major === 3) && minor === 0))) {
        throw new Error(`${source}: 不支持 NPY ${major}.${minor}`);
    }
    const lengthBytes = major === 1 ? 2 : 4;
    const prefixLength = 8 + lengthBytes;
    if (bytes.length < prefixLength) throw new Error(`${source}: NPY header 长度字段被截断`);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const headerLength = lengthBytes === 2 ? view.getUint16(8, true) : view.getUint32(8, true);
    const dataOffset = prefixLength + headerLength;
    if (dataOffset > bytes.length) throw new Error(`${source}: NPY header 被截断`);
    if (dataOffset % 16 !== 0) throw new Error(`${source}: NPY header 未按格式对齐`);
    const headerEncoding = major === 3 ? 'utf-8' : 'latin1';
    const header = new TextDecoder(headerEncoding, { fatal: true }).decode(bytes.subarray(prefixLength, dataOffset));
    if (!header.endsWith('\n')) throw new Error(`${source}: NPY header 未以换行结束`);
    const descr = field(header, 'descr', /['"]([^'"]+)['"]/);
    const order = field(header, 'fortran_order', /(True|False)/) === 'True';
    const shapeSource = field(header, 'shape', /\(([^)]*)\)/);
    const shape = shapeSource.trim() === '' ? [] : shapeSource.split(',')
        .map(part => part.trim()).filter(Boolean).map((part) => {
            if (!/^\d+$/.test(part)) throw new Error(`${source}: NPY shape 含非整数维度 "${part}"`);
            const value = Number(part);
            if (!Number.isSafeInteger(value)) throw new Error(`${source}: NPY shape 维度过大`);
            return value;
        });
    const count = shape.reduce((total, size) => {
        const next = total * size;
        if (!Number.isSafeInteger(next)) throw new Error(`${source}: NPY 元素数量过大`);
        return next;
    }, 1);
    const descriptor = parseDescriptor(descr, source);
    const expected = count * descriptor.bytes;
    if (!Number.isSafeInteger(expected) || bytes.length - dataOffset !== expected) {
        throw new Error(`${source}: NPY 数据字节数 ${bytes.length - dataOffset} 与 dtype/shape 要求 ${expected} 不一致`);
    }
    const payload = bytes.subarray(dataOffset);
    const data = descriptor.kind === 'U'
        ? decodeUnicode(payload, count, descriptor.width, descriptor.littleEndian, shape)
        : decodeNumeric(payload, count, descriptor, source);
    return { dtype: descr, shape, fortranOrder: order, data };
}

function field(header, name, valuePattern) {
    const match = header.match(new RegExp(`['"]${name}['"]\\s*:\\s*${valuePattern.source}`));
    if (!match) throw new Error(`NPY header 缺少或损坏字段 ${name}`);
    return match[1];
}

function parseDescriptor(descr, source) {
    const match = /^([<>=|])([?biufU])(\d+)$/.exec(descr);
    if (!match) {
        if (/[OV]/.test(descr)) throw new Error(`${source}: 不执行 object/pickle NPY dtype ${descr}`);
        throw new Error(`${source}: 不支持 NPY dtype ${descr}`);
    }
    const [, endian, kind, sizeText] = match;
    const width = Number(sizeText);
    const bytes = kind === 'U' ? width * 4 : width;
    const allowed = kind === '?' || kind === 'b' ? width === 1
        : kind === 'i' || kind === 'u' ? [1, 2, 4].includes(width)
            : kind === 'f' ? [4, 8].includes(width)
                : kind === 'U' && width >= 0;
    if (!allowed || !Number.isSafeInteger(bytes)) throw new Error(`${source}: 不支持 NPY dtype ${descr}`);
    return {
        kind: kind === '?' ? 'b' : kind,
        width,
        bytes,
        littleEndian: endian === '<' || endian === '|' || (endian === '=' && HOST_LITTLE_ENDIAN)
    };
}

function decodeNumeric(payload, count, descriptor, source) {
    const { kind, width, littleEndian } = descriptor;
    if (kind === 'b') {
        const result = Uint8Array.from(payload);
        const bad = result.findIndex(value => value !== 0 && value !== 1);
        if (bad >= 0) throw new Error(`${source}: bool 数组第 ${bad} 项不是 0/1`);
        return result;
    }
    const buffer = payload.slice().buffer;
    if (width === 1) return kind === 'i' ? new Int8Array(buffer) : new Uint8Array(buffer);
    if (littleEndian === HOST_LITTLE_ENDIAN) {
        if (kind === 'i') return width === 2 ? new Int16Array(buffer) : new Int32Array(buffer);
        if (kind === 'u') return width === 2 ? new Uint16Array(buffer) : new Uint32Array(buffer);
        return width === 4 ? new Float32Array(buffer) : new Float64Array(buffer);
    }
    const view = new DataView(buffer);
    const result = kind === 'i' ? (width === 2 ? new Int16Array(count) : new Int32Array(count))
        : kind === 'u' ? (width === 2 ? new Uint16Array(count) : new Uint32Array(count))
            : width === 4 ? new Float32Array(count) : new Float64Array(count);
    const getter = kind === 'i' ? `getInt${width * 8}` : kind === 'u' ? `getUint${width * 8}` : `getFloat${width * 8}`;
    for (let i = 0; i < count; i++) result[i] = view[getter](i * width, false);
    return result;
}

function decodeUnicode(payload, count, width, littleEndian, shape) {
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const values = new Array(count);
    for (let i = 0; i < count; i++) {
        const points = [];
        for (let j = 0; j < width; j++) {
            const point = view.getUint32((i * width + j) * 4, littleEndian);
            if (point === 0) break;
            if (point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) throw new Error('NPY Unicode 含非法码点');
            points.push(point);
        }
        values[i] = codePointsToString(points);
    }
    return shape.length === 0 ? values[0] : values;
}

function codePointsToString(points) {
    let result = '';
    for (let at = 0; at < points.length; at += 4096) {
        result += String.fromCodePoint(...points.slice(at, at + 4096));
    }
    return result;
}
