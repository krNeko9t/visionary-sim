import { prepareSceneImport } from './prepareScene.js';
import { fingerprintSourceBuffers } from './sourceFingerprint.js';

self.onmessage = async ({ data }) => {
    try {
        const { geometry, labels, physics } = data.files;
        self.postMessage({ type: 'progress', progress: { phase: 'reading', message: '读取三个已选择文件' } });
        const [geometryBuffer, labelsBuffer, physicsBuffer] = await Promise.all([
            geometry.arrayBuffer(), labels.arrayBuffer(), physics.arrayBuffer()
        ]);
        self.postMessage({ type: 'progress', progress: { phase: 'fingerprinting', message: '计算三个源文件的完整内容指纹' } });
        const sources = await fingerprintSourceBuffers({
            geometry: { name: geometry.name, bytes: geometryBuffer },
            labels: { name: labels.name, bytes: labelsBuffer },
            physics: { name: physics.name, bytes: physicsBuffer }
        });
        const result = await prepareSceneImport({
            geometryBuffer,
            labelsBuffer,
            physicsText: new TextDecoder('utf-8', { fatal: true }).decode(physicsBuffer),
            onProgress: progress => self.postMessage({ type: 'progress', progress })
        });
        result.sources = sources;
        self.postMessage({ type: 'result', result }, transferables(result));
    } catch (error) {
        self.postMessage({ type: 'error', error: {
            message: error instanceof Error ? error.message : String(error),
            phase: error?.phase ?? null,
            file: error?.file ?? null
        } });
    }
};

function transferables(value, found = new Set(), seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return [...found];
    seen.add(value);
    if (value instanceof ArrayBuffer) found.add(value);
    else if (ArrayBuffer.isView(value) && value.buffer instanceof ArrayBuffer) found.add(value.buffer);
    else for (const child of Array.isArray(value) ? value : Object.values(value)) transferables(child, found, seen);
    return [...found];
}
