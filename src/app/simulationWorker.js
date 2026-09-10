import { prepareSceneSimulation } from './simulationPrepare.js';

self.onmessage = ({ data }) => {
    try {
        const result = prepareSceneSimulation(data.input,
            progress => self.postMessage({ type: 'progress', progress }));
        self.postMessage({ type: 'result', result }, transferables(result));
    } catch (error) {
        self.postMessage({
            type: 'error',
            error: { message: error instanceof Error ? error.message : String(error) }
        });
    }
};

function transferables(value, found = new Set(), seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return [...found];
    seen.add(value);
    if (value instanceof ArrayBuffer) found.add(value);
    else if (ArrayBuffer.isView(value) && value.buffer instanceof ArrayBuffer) found.add(value.buffer);
    else for (const child of Array.isArray(value) ? value : Object.values(value)) {
        transferables(child, found, seen);
    }
    return [...found];
}
