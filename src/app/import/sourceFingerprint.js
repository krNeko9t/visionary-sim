/** Complete-byte SHA-256 shared by the import worker and portable configuration. */
export async function fingerprintSourceBuffers(buffers) {
    const result = {};
    // Hash sequentially so WebCrypto does not snapshot three large inputs at once.
    for (const slot of ['geometry', 'labels', 'physics']) {
        const source = buffers?.[slot];
        if (!source || typeof source.name !== 'string' || !source.name.length || !(source.bytes instanceof ArrayBuffer)) {
            throw new Error(`${slot} source needs a name and complete byte ArrayBuffer`);
        }
        if (!globalThis.crypto?.subtle) throw new Error('SHA-256 is unavailable in this browser');
        const digest = await globalThis.crypto.subtle.digest('SHA-256', source.bytes);
        result[slot] = Object.freeze({ name: source.name,
            sha256: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') });
    }
    return Object.freeze(result);
}
