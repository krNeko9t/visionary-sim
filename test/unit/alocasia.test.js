import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCloud } from '../../src/assets/splats/cloud.js';
import { sceneNamed } from '../../src/scene/scenes.js';
import { Simulator } from '../../src/sim/simulator.js';
import { draw } from '../../src/render/draw.js';
import { createSplatView } from '../../src/render/splats.js';
import { createAlocasiaScene, alocasiaScene } from '../../src/scene/alocasia.js';

// Only the engine/GPU boundary is replaced; scene, draw dispatch, splat data
// encoding and modifier installation all run their production implementations.
vi.mock('playcanvas', async importOriginal => ({
    ...await importOriginal(),
    StorageBuffer: class {
        constructor(_device, size) { this.bytes = new Uint8Array(size); }
        write(offset, data) { this.bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), offset); }
        destroy() {}
    },
    Shader: class { destroy() {} },
    Compute: class { setParameter() {} setupDispatch() {} destroy() {} },
    Entity: class {
        constructor(name) { this.name = name; }
        addComponent(_kind, options) {
            this.gsplat = { ...options, setWorkBufferModifier: vi.fn(), setParameter: vi.fn() };
        }
    },
    GSplatResource: class {
        constructor(_device, data) { this.data = data; }
    }
}));

vi.mock('../../src/assets/splats/cloud.js', () => ({ loadCloud: vi.fn() }));

function cloud() {
    return {
        count: 3,
        positions: new Float32Array([0, 0, 0, 0, 0.25, 0, 99, 99, 99]),
        rotations: new Float32Array([0, 0, 0, 1, 0, 0.6, 0, 0.8, 0, 0, 0, 1]),
        scales: new Float32Array(9).fill(0.01),
        colors: new Float32Array(9).fill(0.5),
        opacity: new Float32Array([1, 1, 0.01])
    };
}
function points(xyz) {
    const header = new TextEncoder().encode(`ply\nformat binary_little_endian 1.0\nelement vertex ${xyz.length / 3}\nproperty float x\nproperty float y\nproperty float z\nend_header\n`);
    const bytes = new Uint8Array(header.length + xyz.length * 4);
    bytes.set(header);
    const view = new DataView(bytes.buffer);
    xyz.forEach((v, i) => view.setFloat32(header.length + i * 4, v, true));
    return bytes.buffer;
}
beforeEach(() => {
    vi.clearAllMocks();
    loadCloud.mockResolvedValue(cloud());
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => points([0, 0.25, 0]) }));
});

describe('alocasia scene assembly with an explicitly declared synthetic tolerance', () => {
    it('shares one cleaned foreground between the complete source and disjoint drawing subsets', async () => {
        const scene = createAlocasiaScene({ r: 0.05 });
        const [[body], [fixed]] = await Promise.all([scene.createBodies(), scene.scenery()]);
        expect(loadCloud).toHaveBeenCalledExactlyOnceWith('/splats/alocasia/foreground.ply');
        expect(fetch).toHaveBeenCalledExactlyOnceWith('/splats/alocasia/moving_part_points.ply');
        expect(body.source.cloud.count).toBe(2);
        expect(body.render.cloud.positions).toEqual(new Float32Array([0, 0.25, 0]));
        expect(fixed.cloud.positions).toEqual(new Float32Array([0, 0, 0]));
        expect(body.staticRegion(0, 0, 0)).toBe(true);
        expect(body.staticRegion(0, 0.25, 0)).toBe(false);
        expect(body.elementSize).toBe(0.016);
        expect(body.material).toMatchObject({ youngsModulus: 120000, density: 1000, poissonRatio: 0.4 });
        expect(scene.gravity).toEqual([0, 0, 0]);
        expect(scene.bounds.min[1]).toBe(0);
        expect(scene.bounds.max[1]).toBeGreaterThan(0.25);
        expect(scene.bounds.max[0]).toBeLessThan(1);
        expect(await scene.createBodies()).toEqual([body]);
    });
    it('constructs the real simulator from full foreground and accepts its public material diagnostics', async () => {
        const scene = createAlocasiaScene({ r: 0.05 });
        const bodies = await scene.createBodies();
        const sim = new Simulator({ supportsCompute: true, deviceType: 'test' }, bodies, scene.bounds);
        try {
            const stats = sim.stats();
            expect(stats.perBody[0].staticNodes).toBeGreaterThan(0);
            expect(stats.perBody[0].movableNodes).toBeGreaterThan(0);
            expect(() => scene.validateSimulation(stats)).not.toThrow();
            expect(stats.maxStepsPerFrame).toBe(24);
            expect(stats.grip.radius).toBe(0.03);
            expect(stats.cfl).toBeLessThan(1);
        } finally { sim.destroy(); }
    });
    it('binds only movable Gaussians and keeps fixed centre, rotation and scale at asset values', async () => {
        const scene = createAlocasiaScene({ r: 0.05 });
        const [body] = await scene.createBodies();
        const [fixed] = await scene.scenery();
        const app = { graphicsDevice: {} };
        const positions = new Float32Array([0, 0.25, 0]);
        const field = { shader: '// synthetic field', parameters: { positions } };
        const movingView = draw(app, body.render, field, { name: body.name });
        const fixedView = createSplatView(app, fixed.name, fixed.cloud);
        expect(movingView.gsplat.setWorkBufferModifier).toHaveBeenCalledExactlyOnceWith({ wgsl: expect.stringContaining(field.shader) });
        expect(movingView.gsplat.setParameter).toHaveBeenCalledWith('positions', positions);
        expect(fixedView.gsplat.setWorkBufferModifier).not.toHaveBeenCalled();
        expect(fixedView.gsplat.setParameter).not.toHaveBeenCalled();
        const data = fixedView.gsplat.resource.data;
        const rest = ['x', 'y', 'z', 'rot_0', 'rot_1', 'rot_2', 'rot_3', 'scale_0', 'scale_1', 'scale_2']
            .map(name => Array.from(data.getProp(name)));
        expect(rest).toEqual([[0], [0], [0], [1], [0], [0], [0],
            [Math.fround(0.01)], [Math.fround(0.01)], [Math.fround(0.01)]]);
        positions.set([0.1, 0.4, 0.2]);
        expect(['x', 'y', 'z', 'rot_0', 'rot_1', 'rot_2', 'rot_3', 'scale_0', 'scale_1', 'scale_2']
            .map(name => Array.from(data.getProp(name)))).toEqual(rest);
        expect(fixed.cloud.positions).toEqual(new Float32Array([0, 0, 0]));
    });
    it.each([
        [0, 0, 0, 'no material nodes'],
        [4, 0, 4, 'no fixed material support'],
        [4, 4, 0, 'all material nodes are static']
    ])('rejects degenerate material counts %i/%i/%i with diagnostics', async (materialNodes, staticNodes, movableNodes, reason) => {
        const scene = createAlocasiaScene({ r: 0.05 });
        await scene.prepare();
        expect(() => scene.validateSimulation({ perBody: [{ materialNodes, staticNodes, movableNodes }] }))
            .toThrow(new RegExp(`${reason}.*r=0.05.*movingSamples.*fixedGaussians.*materialNodes`));
        expect(() => scene.validateSimulation({ perBody: [{ materialNodes: 4, staticNodes: 2, movableNodes: 2 }] })).not.toThrow();
    });
    it('reports empty moving samples and skips empty drawing subsets', async () => {
        fetch.mockResolvedValueOnce({ ok: true, arrayBuffer: async () => points([]) });
        await expect(createAlocasiaScene({ r: 0.05 }).prepare()).rejects.toThrow(/no moving samples.*r=0.05.*fixedGaussians/);
        const fixedOnly = createAlocasiaScene({ r: 0 });
        fetch.mockResolvedValueOnce({ ok: true, arrayBuffer: async () => points([10, 10, 10]) });
        expect((await fixedOnly.createBodies())[0].render).toBeNull();
        expect(await createAlocasiaScene({ r: 1 }).scenery()).toEqual([]);
    });
    it('refuses invalid input and missing assets', async () => {
        await expect(createAlocasiaScene({ r: NaN }).prepare()).rejects.toThrow(/tolerance/);
        fetch.mockResolvedValueOnce({ ok: true, arrayBuffer: async () => points([NaN, 0, 0]) });
        await expect(createAlocasiaScene({ r: 0.05 }).prepare()).rejects.toThrow(/finite/);
        fetch.mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' });
        await expect(createAlocasiaScene({ r: 0.05 }).prepare()).rejects.toThrow(/404/);
    });
    it('refuses the uncalibrated production declaration before loading assets', async () => {
        expect(sceneNamed('alocasia')).toBe(alocasiaScene);
        await expect(alocasiaScene.createBodies()).rejects.toThrow(/r.*not calibrated/);
        expect(loadCloud).not.toHaveBeenCalled();
    });
});
