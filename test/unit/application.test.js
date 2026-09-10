import { describe, expect, it, vi } from 'vitest';

import { DemoApplication } from '../../src/app/demo.js';
import { SceneApplication } from '../../src/app/scene.js';
import { DEFAULT_APPLICATION, applicationNamed } from '../../src/app/applications.js';

function fixture(overrides = {}) {
    const events = new Map();
    const engine = {
        graphicsDevice: {},
        root: { addChild: vi.fn() },
        on: vi.fn((name, handler) => events.set(name, handler)),
        off: vi.fn((name, handler) => {
            if (events.get(name) === handler) events.delete(name);
        }),
        start: vi.fn(),
        destroy: vi.fn()
    };
    const body = {
        name: 'body',
        source: {},
        render: { kind: 'mesh', mesh: {} },
        material: { density: 1000 }
    };
    const sim = {
        params: { paused: false },
        tank: { min: [0, 0, 0], max: [1, 1, 1] },
        simBodies: [{ body, lattice: {} }],
        deformationOf: vi.fn(() => ({})),
        stats: vi.fn(() => ({
            deviceType: 'webgpu', bodyCount: 1, cells: 1, tets: 5, nodes: 8,
            stepDuration: 1 / 240, cfl: 0.5, maxStepsPerFrame: 24, limitedBy: 'body',
            grip: { radius: 0.03, strategy: 'withinRadius', worstCase: 1, capacity: 4096 },
            perBody: [{ name: 'body', h: 0.1, gamma: 0.5, collapseScale: 0.1 }]
        })),
        step: vi.fn(), requestStep: vi.fn(), reset: vi.fn(), setMaterial: vi.fn((_, patch) => Object.assign(body.material, patch)),
        setContact: vi.fn(), setDriveLaw: vi.fn(), setGrip: vi.fn(), setGripRadius: vi.fn(),
        grab: vi.fn(async () => null), moveGrab: vi.fn(), releaseGrab: vi.fn(), destroy: vi.fn()
    };
    const panelElement = { remove: vi.fn() };
    let panelActions;
    const deps = {
        sceneNamed: vi.fn(() => ({
            name: 'tank', bounds: sim.tank, decorate: vi.fn(), createBodies: vi.fn(async () => [body])
        })),
        createEngine: vi.fn(async () => engine),
        createStage: vi.fn(() => ({ camera: {} })),
        createMeshView: vi.fn(() => ({})),
        createSplatView: vi.fn(() => ({})),
        destroySplatView: vi.fn(),
        createLatticeView: vi.fn(() => ({ enabled: false })),
        createPanel: vi.fn((getState, actions) => {
            panelActions = actions;
            expect(getState().bodies[0].name).toBe('body');
            return { element: panelElement, update: vi.fn() };
        }),
        attachGrabber: vi.fn(() => ({ detach: vi.fn() })),
        Simulator: vi.fn(function FakeSimulator() { return sim; }),
        ...overrides
    };
    const host = { append: vi.fn() };
    const browser = {
        addEventListener: vi.fn(), removeEventListener: vi.fn()
    };
    const application = new DemoApplication({ canvas: {}, sceneName: 'tank', host, browser, deps });
    return { application, body, browser, deps, engine, events, host, panelElement, sim, get panelActions() { return panelActions; } };
}

describe('the demo application session', () => {
    it('is the default concrete application selected by the entry', () => {
        const selected = applicationNamed(null, { canvas: {}, host: {}, browser: {}, deps: {} });
        expect(DEFAULT_APPLICATION).toBe('demo');
        expect(selected).toBeInstanceOf(DemoApplication);
        expect(applicationNamed('scene', { canvas: {}, host: {}, browser: {}, deps: {} })).toBeInstanceOf(SceneApplication);
        expect(() => applicationNamed('missing', {})).toThrow('no application named "missing"');
    });

    it('owns assembly, observable operations and idempotent cleanup', async () => {
        const f = fixture();
        const observed = [];
        const unsubscribe = f.application.subscribe(state => observed.push(state.phase));
        const first = f.application.start();
        expect(f.application.start()).toBe(first);
        await first;

        expect(f.application.state()).toMatchObject({ phase: 'running', sceneName: 'tank', paused: false });
        expect(f.host.append).toHaveBeenCalledOnce();
        expect(f.engine.start).toHaveBeenCalledOnce();
        expect(f.events.has('update')).toBe(true);

        f.panelActions.setPaused(true);
        f.panelActions.setMaterial(0, { density: 850 });
        f.panelActions.setLatticeVisible(true);
        expect(f.application.state()).toMatchObject({ paused: true, latticeVisible: true });
        expect(f.application.state().bodies[0].material.density).toBe(850);
        expect(observed).toContain('running');

        const grabber = f.application.grabber;
        f.application.destroy();
        f.application.destroy();
        unsubscribe();
        expect(grabber.detach).toHaveBeenCalledOnce();
        expect(f.sim.destroy).toHaveBeenCalledOnce();
        expect(f.panelElement.remove).toHaveBeenCalledOnce();
        expect(f.engine.destroy).toHaveBeenCalledOnce();
        expect(f.events.has('update')).toBe(false);
        expect(f.application.state().phase).toBe('destroyed');
        expect(f.application.listeners.size).toBe(0);
    });

    it('cleans a late engine when startup is ended before it resolves', async () => {
        let resolveEngine;
        const engineReady = new Promise(resolve => { resolveEngine = resolve; });
        const f = fixture({ createEngine: vi.fn(() => engineReady) });
        const started = f.application.start();
        f.application.destroy();
        resolveEngine(f.engine);

        await expect(started).rejects.toThrow('session ended during startup');
        expect(f.engine.destroy).toHaveBeenCalledOnce();
        expect(f.application.state().phase).toBe('destroyed');
    });

    it('releases prepared scenery if body preparation fails and allows retry', async () => {
        const f = fixture();
        const scene = f.deps.sceneNamed();
        f.deps.sceneNamed.mockReturnValue(scene);
        scene.scenery = async () => [{ name: 'backdrop', cloud: {} }];
        scene.createBodies.mockRejectedValueOnce(new Error('body preparation failed'));
        await expect(f.application.start()).rejects.toThrow('body preparation failed');
        expect(f.deps.destroySplatView).toHaveBeenCalledOnce();
        expect(f.application.state().phase).toBe('failed');
        await f.application.start();
        expect(f.application.state().phase).toBe('running');
        f.application.destroy();
        expect(f.deps.destroySplatView).toHaveBeenCalledTimes(2);
    });

    it('keeps lifecycle transitions independent from failing observers', async () => {
        const f = fixture();
        const brokenInitial = vi.fn(() => { throw new Error('initial observer failed'); });
        expect(() => f.application.subscribe(brokenInitial)).toThrow('initial observer failed');
        const received = [];
        f.application.subscribe(state => {
            if (state.phase === 'starting') throw new Error('observer failed');
        });
        f.application.subscribe(state => received.push(state.phase));
        const logging = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            await f.application.start();
            f.application.update(1 / 60);
            f.application.destroy();
            expect(received).toContain('running');
            expect(received.at(-1)).toBe('destroyed');
            expect(brokenInitial).toHaveBeenCalledOnce();
        } finally {
            logging.mockRestore();
        }
    });
});
