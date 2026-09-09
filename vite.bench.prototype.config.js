import { defineConfig } from 'vite';
import { createReadStream, statSync } from 'node:fs';

// Read-only sample fixtures; conversion and rendering happen in the browser.
const fixtures = {
    '/__bench/point_cloud.ply': '/home/liaowanjun/Datas/instascene_preprocessed_data/3dovs/bench/point_cloud.ply',
    '/__bench/labels.npz': '/home/liaowanjun/tmp/mx_runs/bench_504x336/labels.npz',
    '/__bench/instance_physics.json': '/home/liaowanjun/tmp/mx_runs/bench_504x336/instance_physics.json',
    '/__bench/images.bin': '/home/liaowanjun/Datas/instascene_preprocessed_data/3dovs/bench/sparse/0/images.bin'
};
export default defineConfig({
    server: { host: '127.0.0.1', port: 5174, strictPort: true },
    build: { target: 'esnext', outDir: '/tmp/bench-prototype-build', emptyOutDir: true,
        rolldownOptions: { input: 'src/ui/bench.prototype.html' } },
    plugins: [{ name: 'local-bench-prototype', configureServer(server) {
        server.middlewares.use((req, res, next) => {
            const path = fixtures[req.url];
            if (!path) return next();
            try {
                res.setHeader('Content-Length', statSync(path).size);
                res.setHeader('Content-Type', 'application/octet-stream');
                const stream = createReadStream(path);
                stream.on('error', () => res.destroy());
                stream.pipe(res);
            } catch (error) { res.statusCode = 404; res.end(error.message); }
        });
    } }]
});
