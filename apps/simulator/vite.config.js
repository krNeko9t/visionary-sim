import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        // WebGPU needs a secure context; localhost qualifies.
        host: '127.0.0.1',
        port: 5173
    },
    build: {
        target: 'esnext'
    }
});
