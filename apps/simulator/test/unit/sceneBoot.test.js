import { beforeEach, expect, it, vi } from 'vitest';
import { draw } from '../../src/render/draw.js';
import { createSplatView } from '../../src/render/splats.js';

const state = vi.hoisted(() => ({ scene: null, events: [], app: null, sim: null }));
vi.mock('../../src/render/playcanvasInterop.js', () => ({ nativeDevice: device => device }));
vi.mock('../../src/scene/scenes.js', () => ({ sceneNamed: () => state.scene }));
vi.mock('../../src/scene/app.js', () => ({
    WebGpuUnavailableError: class extends Error {},
    createApp: async () => state.app
}));
vi.mock('../../src/scene/stage.js', () => ({ createStage: (_app, bounds) => {
    state.events.push(['stage', bounds]); return { camera: {} };
} }));
vi.mock('../../src/render/draw.js', () => ({ draw: vi.fn(() => ({})) }));
vi.mock('../../src/render/splats.js', () => ({ createSplatView: vi.fn(() => ({})) }));
vi.mock('../../src/ui/panel.js', () => ({ createPanel: () => ({ element: {}, update() {} }) }));
vi.mock('../../src/ui/grab.js', () => ({ attachGrabber() {} }));
vi.mock('visionary-sim/sim/simulator.js', () => ({ Simulator: class {
    constructor(_device, _bodies, bounds) {
        state.events.push(['sim', bounds]); state.sim = this;
        state.bodies = _bodies;
        this.params = { gravity: [0, -9.81, 0] }; this.simBodies = _bodies.map(body => ({ body, proxy: { wireframe: () => ({ kind: 'lines' }) } }));
    }
    deformationOf(index) { return { index }; }
    stats() { return { scale: [], stepDuration: 0.004, cfl: 0.5, perBody: [] }; }
    step() { state.events.push(['step', this.params.gravity]); }
    setDriveLaw(law) { state.events.push(['driveLaw', law]); }
    setDriveResponseTime(seconds) { state.events.push(['responseTime', seconds]); }
    destroy() { state.events.push(['destroy']); }
} }));

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    state.events = [];
    const listeners = {};
    state.app = { graphicsDevice: {}, root: { addChild: vi.fn() },
        on: (event, cb) => listeners[event] = cb,
        start: () => { state.events.push(['start']); listeners.update(1 / 60); },
        destroy: vi.fn(() => listeners.destroy?.())
    };
    const canvas = { style: {} };
    vi.stubGlobal('window', { location: { search: '' } });
    vi.stubGlobal('document', { getElementById: () => canvas,
        createElement: () => ({ setAttribute() {}, style: {} }), body: { append: vi.fn() } });
    state.scene = { name: 'test', bounds: null, decorate: vi.fn(),
        async prepare() { await Promise.resolve(); this.bounds = { min: [-1, 0, -1], max: [1, 1, 1] }; },
        async createObjects() { return []; }, scenery: async () => [{ name: 'fixed', cloud: { count: 1 } }]
    };
});

it.each([[undefined], [[0, 0, 0]]])('prepares final bounds and applies gravity %j before the first step', async gravity => {
    state.scene.gravity = gravity;
    const { startup } = await import('../../src/main.js');
    await startup;
    expect(state.events[0]).toEqual(['sim', state.scene.bounds]);
    expect(state.events).toContainEqual(['stage', state.scene.bounds]);
    expect(state.events).toContainEqual(['step', gravity ?? [0, -9.81, 0]]);
});

it('rejects material diagnostics before drawing, decorating or starting a frame', async () => {
    state.scene.validateSimulation = () => { throw new Error('no fixed material support'); };
    const { startup } = await import('../../src/main.js');
    await startup;
    expect(state.app.root.addChild).not.toHaveBeenCalled();
    expect(state.scene.decorate).not.toHaveBeenCalled();
    expect(state.events).not.toContainEqual(['start']);
    expect(state.events).toContainEqual(['destroy']);
    expect(state.app.destroy).toHaveBeenCalledOnce();
    expect(document.body.append).toHaveBeenCalledWith(expect.objectContaining({ textContent: expect.stringContaining('no fixed material support') }));
});

it('applies scene interaction settings before starting the application', async () => {
    state.scene.grab = { law: 'compliant', responseTime: 0.003 };
    await (await import('../../src/main.js')).startup;
    expect(state.events).toContainEqual(['driveLaw', 'compliant']);
    expect(state.events).toContainEqual(['responseTime', 0.003]);
    expect(state.events.findIndex(([type]) => type === 'responseTime'))
        .toBeLessThan(state.events.findIndex(([type]) => type === 'start'));
});

it('keeps scenes without preparation or gravity declarations working', async () => {
    delete state.scene.prepare;
    state.scene.bounds = { min: [-1, 0, -1], max: [1, 1, 1] };
    delete state.scene.scenery;
    const { startup } = await import('../../src/main.js');
    await startup;
    expect(state.events).toContainEqual(['step', [0, -9.81, 0]]);
});

it.each([null, { kind: 'gaussians', cloud: { count: 0 } }])('skips empty body drawing %j but retains proxy wireframe', async render => {
    state.scene.createObjects = async () => [{ body: { name: 'empty drawing', source: {} }, render }];
    state.scene.scenery = async () => [{ name: 'empty fixed drawing', cloud: { count: 0 } }];
    const { startup } = await import('../../src/main.js');
    await startup;
    expect(createSplatView).not.toHaveBeenCalled();
    expect(draw).toHaveBeenCalledExactlyOnceWith(state.app, { kind: 'lines' }, { index: 0 }, { name: 'empty drawing' });
    expect(window.wireframeViews[0].enabled).toBe(false);
});

it('uses observation bounds without enlarging the solver', async () => {
    state.scene.viewBounds = { min: [-10, -2, -10], max: [10, 4, 10] };
    const { startup } = await import('../../src/main.js');
    await startup;
    expect(state.events).toContainEqual(['sim', state.scene.bounds]);
    expect(state.events).toContainEqual(['stage', state.scene.viewBounds]);
});

it('cleans the app and simulator once when a later scenery layer fails to draw', async () => {
    state.scene.scenery = async () => [
        { name: 'fixed', cloud: { count: 1 } }, { name: 'background', cloud: { count: 1 } }
    ];
    createSplatView.mockImplementationOnce(() => ({})).mockImplementationOnce(() => { throw new Error('background GPU failure'); });
    const { startup } = await import('../../src/main.js');
    await startup;
    expect(state.app.destroy).toHaveBeenCalledOnce();
    expect(state.events.filter(([event]) => event === 'destroy')).toHaveLength(1);
    expect(state.events).not.toContainEqual(['start']);
    expect(document.body.append).toHaveBeenCalledWith(expect.objectContaining({ textContent: expect.stringContaining('background GPU failure') }));
});


it('destroys the simulator once with the scene application', async () => {
    const { startup } = await import('../../src/main.js');
    const app = await startup;
    app.destroy();
    app.destroy();
    expect(state.events.filter(([event]) => event === 'destroy')).toHaveLength(1);
});

it('cleans previously attached scenery when movable drawing fails', async () => {
    state.scene.createObjects = async () => [{ body: { name: 'moving', source: {} }, render: { kind: 'gaussians', cloud: { count: 1 } } }];
    draw.mockImplementationOnce(() => { throw new Error('moving GPU failure'); });
    const { startup } = await import('../../src/main.js');
    await startup;
    expect(createSplatView).toHaveBeenCalledOnce();
    expect(state.app.destroy).toHaveBeenCalledOnce();
    expect(state.events.filter(([event]) => event === 'destroy')).toHaveLength(1);
    expect(state.events).not.toContainEqual(['start']);
});


it('pairs drawing and wireframes by construction position even across an undrawn body', async () => {
    const bodies = [{ name: 'same' }, { name: 'same' }, { name: 'same' }];
    const mesh = { kind: 'triangles', mesh: {} };
    const cloud = { kind: 'gaussians', cloud: { count: 1 } };
    state.scene.createObjects = async () => [
        { body: bodies[0], render: mesh, tint: [0.2, 0.4, 0.6] },
        { body: bodies[1], render: null },
        { body: bodies[2], render: cloud }
    ];
    await (await import('../../src/main.js')).startup;
    expect(state.bodies).toEqual(bodies);
    expect(draw.mock.calls.map(([, geometry, field, options]) => [geometry.kind, field.index, options.tint]))
        .toEqual([['triangles', 0, [0.2, 0.4, 0.6]], ['lines', 0, undefined],
            ['lines', 1, undefined], ['gaussians', 2, undefined], ['lines', 2, undefined]]);
    expect(window.wireframeViews).toHaveLength(3);
});
