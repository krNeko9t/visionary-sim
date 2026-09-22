import { Entity } from 'playcanvas';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCloud } from '../../src/assets/splats/cloud.js';
import { sceneNamed } from '../../src/scene/scenes.js';
import { Simulator } from '../../src/sim/simulator.js';
import { draw } from '../../src/render/draw.js';
import { createSplatView } from '../../src/render/splats.js';
import { createAlocasiaScene, alocasiaScene } from '../../src/scene/alocasia.js';

// Only the engine/GPU boundary is replaced; scene, draw dispatch, splat data
// encoding and modifier installation all run their production implementations.
const gpu = vi.hoisted(() => ({ resources: [] }));
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
        constructor(name) { this.name = name; this.listeners = {}; }
        once(event, fn) { this.listeners[event] = fn; }
        destroy() { const fn = this.listeners.destroy; delete this.listeners.destroy; fn?.(); }
        addComponent(_kind, options) {
            this.gsplat = { ...options, setWorkBufferModifier: vi.fn(), setParameter: vi.fn() };
        }
    },
    GSplatResource: class {
        constructor(_device, data) { this.data = data; this.destroy = vi.fn(); gpu.resources.push(this); }
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
function background() {
    const result = cloud();
    result.positions.set([2, -1, 3, -2, 2, -3, 99, 99, 99]);
    return result;
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
    gpu.resources = [];
    loadCloud.mockImplementation(async url => url.endsWith('background.ply') ? background() : cloud());
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => points([0, 0.25, 0]) }));
});

describe('alocasia scene assembly with an explicitly declared synthetic tolerance', () => {
    it('shares one cleaned foreground between the complete source and disjoint drawing subsets', async () => {
        const scene = createAlocasiaScene({ r: 0.05 });
        const [[body], [fixed, backdrop]] = await Promise.all([scene.createBodies(), scene.scenery()]);
        expect(loadCloud).toHaveBeenCalledTimes(2);
        expect(loadCloud).toHaveBeenCalledWith('/splats/alocasia/foreground.ply');
        expect(loadCloud).toHaveBeenCalledWith('/splats/alocasia/background.ply');
        expect(backdrop.cloud.positions).toEqual(new Float32Array([2, -1, 3, -2, 2, -3]));
        expect(scene.viewBounds.min).toEqual([-2, -1, -3]);
        expect(scene.viewBounds.max).toEqual([2, 2, 3]);
        expect(scene.counts).toMatchObject({ inputForeground: 3, inputBackground: 3, foregroundDiscarded: 1, backgroundDiscarded: 1, movableGaussians: 1, fixedGaussians: 1, backgroundGaussians: 2 });
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
    it('does not attach the outside of a movable thin leaf to the world', async () => {
        const scene = createAlocasiaScene({ r: 0.016 });
        const bodies = await scene.createBodies();
        const sim = new Simulator({ supportsCompute: true, deviceType: 'test' }, bodies, scene.bounds);
        try {
            const { particles } = sim;
            const leafNodes = Array.from({ length: particles.nodeCount }, (_, i) => i)
                .filter(i => particles.invMass[i] > 0 && particles.restPositions[i * 4 + 1] > 0.2);
            expect(leafNodes.length).toBeGreaterThan(0);
            expect(leafNodes.filter(i => particles.staticPrescribed.has(i))).toEqual([]);
            expect(sim.stats().perBody[0].staticNodes).toBeGreaterThan(0);
        } finally { sim.destroy(); }
    });
    it('binds only movable Gaussians and keeps fixed centre, rotation and scale at asset values', async () => {
        const scene = createAlocasiaScene({ r: 0.05 });
        const [body] = await scene.createBodies();
        const [fixed, backdrop] = await scene.scenery();
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
        const backdropView = createSplatView(app, backdrop.name, backdrop.cloud);
        expect(backdropView.gsplat.setWorkBufferModifier).not.toHaveBeenCalled();
        expect(backdropView.gsplat.setParameter).not.toHaveBeenCalled();
        const backgroundData = backdropView.gsplat.resource.data;
        const props = ['x', 'y', 'z', 'rot_0', 'rot_1', 'rot_2', 'rot_3', 'scale_0', 'scale_1', 'scale_2'];
        const before = props.map(name => Array.from(backgroundData.getProp(name)));
        positions.set([100, 100, 100]);
        expect(props.map(name => Array.from(backgroundData.getProp(name)))).toEqual(before);
        expect(backdrop.cloud).toEqual(expect.objectContaining({
            positions: new Float32Array([2, -1, 3, -2, 2, -3]),
            rotations: background().rotations.slice(0, 8), scales: background().scales.slice(0, 6)
        }));
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
        expect((await createAlocasiaScene({ r: 1 }).scenery()).map(item => item.name)).toEqual(['alocasia-background']);
    });
    it('refuses invalid input and missing assets', async () => {
        await expect(createAlocasiaScene({ r: NaN }).prepare()).rejects.toThrow(/tolerance/);
        fetch.mockResolvedValueOnce({ ok: true, arrayBuffer: async () => points([NaN, 0, 0]) });
        await expect(createAlocasiaScene({ r: 0.05 }).prepare()).rejects.toThrow(/finite/);
        fetch.mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' });
        await expect(createAlocasiaScene({ r: 0.05 }).prepare()).rejects.toThrow(/404/);
    });
    it('loads the production declaration with the calibrated metric region', async () => {
        const scene = sceneNamed('alocasia');
        expect(scene).toBe(alocasiaScene);
        const [body] = await scene.createBodies();
        expect(body.source.report).toContain('alocasia r=0.016 m;');
        expect(body.staticRegion(0.0159, 0.25, 0)).toBe(false);
        // Extra proxy thickness inherits the nearest measured material; it
        // must not become an attachment just outside the measurement radius.
        expect(body.staticRegion(0.0161, 0.25, 0)).toBe(false);
        expect(body.material.maxStretch).toBe(1.05);
        expect(body.material.damping).toBe(2);
        expect(scene.grab).toEqual({ law: 'compliant', responseTime: 0.003 });
        expect(scene.counts).toMatchObject({ movableGaussians: 1, fixedGaussians: 1, backgroundGaussians: 2 });
        expect((await scene.scenery()).map(item => item.name)).toEqual(['alocasia-fixed', 'alocasia-background']);
    });
    it('refuses an undeclared API tolerance before loading assets', async () => {
        await expect(createAlocasiaScene().createBodies()).rejects.toThrow(/r.*not calibrated/);
        expect(loadCloud).not.toHaveBeenCalled();
    });
});


it('releases each direct Gaussian resource once when its view is destroyed', async () => {
    const scene = createAlocasiaScene({ r: 0.05 });
    const views = (await scene.scenery()).map(item => createSplatView({ graphicsDevice: {} }, item.name, item.cloud));
    for (const view of views) {
        const resource = view.gsplat.resource;
        view.destroy();
        view.destroy();
        expect(resource.destroy).toHaveBeenCalledOnce();
    }
});


it('background changes neither solver bounds nor material, contact or grab candidates', async () => {
    const full = createAlocasiaScene({ r: 0.05 });
    const fullBodies = await full.createBodies();
    // The alternate backdrop is entirely removed by the same opacity rule.
    loadCloud.mockImplementation(async url => {
        const result = cloud();
        if (url.endsWith('background.ply')) result.opacity.fill(0);
        return result;
    });
    const empty = createAlocasiaScene({ r: 0.05 });
    const emptyBodies = await empty.createBodies();
    expect((await empty.scenery()).map(item => item.name)).toEqual(['alocasia-fixed']);
    expect(empty.counts.backgroundGaussians).toBe(0);
    expect(empty.viewBounds).toEqual({ min: [0, 0, 0], max: [0, 0.25, 0] });
    expect(empty.bounds).toEqual(full.bounds);
    expect(emptyBodies[0].source.cloud).toEqual(fullBodies[0].source.cloud);
    const sims = [fullBodies, emptyBodies].map(bodies => new Simulator({ supportsCompute: true, deviceType: 'test' }, bodies, full.bounds));
    try {
        expect(sims[0].stats().perBody).toEqual(sims[1].stats().perBody);
        expect(sims[0].stats().bodyCount).toBe(1);
    } finally { sims.forEach(sim => sim.destroy()); }
});

it.each(['missing', 'nonfinite', 'incomplete'])('rejects %s background consistently at every shared entry', async failure => {
    loadCloud.mockImplementation(async url => {
        if (!url.endsWith('background.ply')) return cloud();
        if (failure === 'missing') throw new Error('background.ply: 404');
        const result = background();
        if (failure === 'nonfinite') result.positions[0] = NaN;
        else result.scales = new Float32Array(1);
        return result;
    });
    const scene = createAlocasiaScene({ r: 0.05 });
    const results = await Promise.allSettled([scene.prepare(), scene.createBodies(), scene.scenery()]);
    expect(results.every(result => result.status === 'rejected')).toBe(true);
    expect(results[0].reason.message).toMatch(/background/);
    expect(results[1].reason).toBe(results[0].reason);
    expect(results[2].reason).toBe(results[0].reason);
    expect(loadCloud).toHaveBeenCalledTimes(2);
    expect(scene.bounds).toBeNull();
});


it('releases a resource when attaching its drawing component fails', () => {
    vi.spyOn(Entity.prototype, 'addComponent').mockImplementationOnce(() => { throw new Error('component failed'); });
    expect(() => createSplatView({ graphicsDevice: {} }, 'background', background())).toThrow('component failed');
    expect(gpu.resources).toHaveLength(1);
    expect(gpu.resources[0].destroy).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
});

it('isolates multiple factory declarations, snapshots settings, and makes fixed support explicit', async () => {
    const { createPhysDreamerScene } = await import('../../src/scene/physdreamer.js');
    const { ALOCASIA } = await import('../../src/scene/physdreamerDeclarations.js');
    const declaration = { ...ALOCASIA, name: 'synthetic-a', assetRoot: '/synthetic/a', r: 0.05,
        material: { damping: 3 }, grab: { law: 'compliant', responseTime: 0.01 } };
    const a = createPhysDreamerScene(declaration);
    const b = createPhysDreamerScene({ ...ALOCASIA, name: 'synthetic-b', assetRoot: '/synthetic/b', r: 1,
        elementSize: 0.03, requireFixedMaterial: false });
    declaration.r = 1; declaration.material.damping = 9; declaration.grab.responseTime = 9;
    const [[bodyA], [bodyB]] = await Promise.all([a.createBodies(), b.createBodies()]);
    expect(loadCloud).toHaveBeenCalledWith('/synthetic/a/foreground.ply');
    expect(loadCloud).toHaveBeenCalledWith('/synthetic/b/background.ply');
    expect(a.counts).toMatchObject({ movableGaussians: 1, fixedGaussians: 1 });
    expect(b.counts).toMatchObject({ movableGaussians: 2, fixedGaussians: 0 });
    expect(bodyA.material.damping).toBe(3);
    expect(a.grab.responseTime).toBe(0.01);
    expect(bodyB.elementSize).toBe(0.03);
    expect(bodyA.staticRegion(0.03, 0.25, 0)).toBe(false);
    expect(bodyA.source.cloud).not.toBe(bodyB.source.cloud);
    expect((await b.scenery()).map(item => item.name)).toEqual(['synthetic-b-background']);
    const allMoving = { perBody: [{ materialNodes: 4, staticNodes: 0, movableNodes: 4 }] };
    expect(() => b.validateSimulation(allMoving)).not.toThrow();
    expect(() => a.validateSimulation(allMoving)).toThrow(/synthetic-a.*no fixed material support/);
    expect(() => b.validateSimulation({ perBody: [] })).toThrow(/synthetic-b.*no material nodes/);
    expect(() => b.validateSimulation({ perBody: [{ materialNodes: 4, staticNodes: 4, movableNodes: 0 }] })).toThrow(/all material nodes are static/);
    expect(ALOCASIA).toMatchObject({ r: 0.016, elementSize: 0.016, material: { damping: 2, maxStretch: 1.05 }, grab: { responseTime: 0.003 } });
});


describe('PhysDreamer shared factory registration', () => {
    it.each(['hat', 'carnations', 'telephone'])('%s loads isolated assets and preserves complete foreground physics and static background', async (name) => {
        const scene = sceneNamed(name);
        const [body] = await scene.createBodies();
        const scenery = await scene.scenery();
        expect(loadCloud).toHaveBeenCalledWith(`/splats/${name}/foreground.ply`);
        expect(loadCloud).toHaveBeenCalledWith(`/splats/${name}/background.ply`);
        expect(fetch).toHaveBeenCalledWith(`/splats/${name}/moving_part_points.ply`);
        expect(body.source.cloud.count).toBe(2);
        expect(body.render.cloud.count).toBe(1);
        expect(scenery.map(view => view.name)).toEqual([`${name}-fixed`, `${name}-background`]);
        expect(body.staticRegion(0, 0, 0)).toBe(true);
        expect(body.staticRegion(0, 0.25, 0)).toBe(false);
        expect(scene.gravity).toEqual([0, 0, 0]);
        expect(scene.grab).toEqual({ law: 'compliant', responseTime: 0.003 });
        const sim = new Simulator({ supportsCompute: true, deviceType: 'test' }, [body], scene.bounds);
        try { expect(() => scene.validateSimulation(sim.stats())).not.toThrow(); }
        finally { sim.destroy(); }
    });
});
