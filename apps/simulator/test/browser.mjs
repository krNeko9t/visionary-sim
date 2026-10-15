/**
 * A DevTools-protocol client for the browser tests. It connects to an isolated
 * Chrome that something else started with `--remote-debugging-port`, opens tabs
 * of its own, and closes only those. Node 24's built-in WebSocket; no packages.
 *
 * @param {string} cdp - The Chrome's DevTools HTTP endpoint.
 * @param {{ timeoutMs?: number }} [options] - Longest any one command may take.
 * @returns {Promise<{ version: object, send: Function, openPage: Function, close: Function }>}
 */
export async function connect(cdp, { timeoutMs = 120000 } = {}) {
    const version = await (await fetch(`${cdp}/json/version`)).json();
    const socket = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    const pending = new Map();
    let serial = 0;
    socket.onmessage = event => {
        const message = JSON.parse(event.data);
        const entry = pending.get(message.id);
        if (!entry) return;
        clearTimeout(entry.timeout);
        pending.delete(message.id);
        if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
        else entry.resolve(message.result);
    };
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
        const id = ++serial;
        const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
        pending.set(id, { resolve, reject, timeout });
        socket.send(JSON.stringify({ id, method, params, sessionId }));
    });

    /**
     * @param {string} url - Page to open in a new tab.
     * @returns {Promise<{ evaluate: (expression: string) => Promise<any>,
     *   waitFor: (expression: string) => Promise<boolean>, close: () => Promise<void> }>}
     */
    const openPage = async (url) => {
        const { targetId } = await send('Target.createTarget', { url });
        const close = () => send('Target.closeTarget', { targetId });
        let sessionId;
        try {
            ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
        } catch (error) {
            await close();
            throw error;
        }
        const evaluate = async expression => {
            const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
            if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
            return result.result.value;
        };
        /** Polls `expression` for 30 s; whether it became true. */
        const waitFor = async expression => {
            for (let i = 0; i < 120; i++) {
                if (await evaluate(expression)) return true;
                await new Promise(resolve => setTimeout(resolve, 250));
            }
            return false;
        };
        return { evaluate, waitFor, close };
    };

    return { version, send, openPage, close: () => socket.close() };
}
