import { afterEach, describe, expect, it, vi } from 'vitest';

import { mountSimulationControls } from '../../src/ui/simulationControls.js';

afterEach(() => vi.unstubAllGlobals());

class Element {
    constructor(tag) {
        this.tag = tag;
        this.children = [];
        this.listeners = new Map();
        this.className = '';
        this.disabled = false;
        this.hidden = false;
        this.textContent = '';
    }

    append(...children) {
        for (const child of children) {
            if (typeof child === 'string') this.textContent += child;
            else this.children.push(child);
        }
    }

    replaceChildren(...children) { this.children = [...children]; }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    remove() { this.removed = true; }
    click() {
        if (this.disabled) return undefined;
        return this.listeners.get('click')?.({ type: 'click', target: this });
    }
}

function state(phase, participantIds, selected, grabbing = false) {
    return {
        scene: {},
        inspection: { selected },
        simulation: { phase, participantIds, grabbing, metrics: null, timing: null, progress: null, error: null }
    };
}

function actionButtons(mounted) {
    return mounted.element.children[4].children;
}

describe('simulation controls append flow', () => {
    it('starts with the first selection, then appends a different eligible selection through DOM clicks', async () => {
        vi.stubGlobal('document', { createElement: tag => new Element(tag) });
        let render;
        let current = state('preparation', [], { id: 7, eligible: true });
        const application = {
            subscribe(listener) {
                render = listener;
                listener(current);
                return () => {};
            },
            addSelectedToSimulation: vi.fn(async () => {})
        };
        const mounted = mountSimulationControls({ host: new Element('host'), application });

        const firstAdd = actionButtons(mounted).find(value => value.textContent === '将所选实例加入模拟');
        expect(firstAdd?.disabled).toBe(false);
        await firstAdd.click();
        expect(application.addSelectedToSimulation).toHaveBeenCalledTimes(1);

        current = state('running', [7], { id: 12, eligible: true });
        render(current);
        const append = actionButtons(mounted).find(value => value.textContent === '将所选实例追加到模拟');
        expect(append?.disabled).toBe(false);
        await append.click();

        expect(application.addSelectedToSimulation).toHaveBeenCalledTimes(2);
    });

    it('allows append while paused, blocks participating selections, and exposes none during transitions', async () => {
        vi.stubGlobal('document', { createElement: tag => new Element(tag) });
        let render;
        const application = {
            subscribe(listener) {
                render = listener;
                listener(state('running', [7], { id: 7, eligible: true }));
                return () => {};
            },
            addSelectedToSimulation: vi.fn(async () => {}),
            pauseSimulation: vi.fn(async () => {}),
            resumeSimulation: vi.fn(async () => {}),
            returnToPreparation: vi.fn(async () => {}),
            cancelSimulationPreparation: vi.fn()
        };
        const mounted = mountSimulationControls({ host: new Element('host'), application });

        const alreadyAdded = actionButtons(mounted).find(value => value.textContent === '所选实例已在模拟中');
        expect(alreadyAdded?.disabled).toBe(true);
        await alreadyAdded.click();
        expect(application.addSelectedToSimulation).not.toHaveBeenCalled();

        render(state('paused', [7], { id: 12, eligible: true }));
        const pausedAppend = actionButtons(mounted).find(value => value.textContent === '将所选实例追加到模拟');
        await pausedAppend.click();
        expect(application.addSelectedToSimulation).toHaveBeenCalledOnce();

        for (const phase of ['preparing', 'returning']) {
            render(state(phase, [7, 12], { id: 13, eligible: true }));
            expect(actionButtons(mounted).some(value => value.textContent.includes('加入') || value.textContent.includes('追加')))
                .toBe(false);
        }
    });

    it('toggles grabbing through a real running-state button without pausing simulation', async () => {
        vi.stubGlobal('document', { createElement: tag => new Element(tag) });
        let render;
        let current = state('running', [7], { id: 12, eligible: true }, true);
        const application = {
            subscribe(listener) {
                render = listener;
                listener(current);
                return () => {};
            },
            setGrabbing: vi.fn(async enabled => {
                current = state('running', [7], { id: 12, eligible: true }, enabled);
                render(current);
            }),
            addSelectedToSimulation: vi.fn(),
            pauseSimulation: vi.fn(),
            returnToPreparation: vi.fn()
        };
        const mounted = mountSimulationControls({ host: new Element('host'), application });

        const disable = actionButtons(mounted).find(value => value.textContent === '关闭抓取');
        await disable.click();

        expect(application.setGrabbing).toHaveBeenCalledWith(false);
        expect(current.simulation).toMatchObject({ phase: 'running', grabbing: false });
        expect(actionButtons(mounted).some(value => value.textContent === '开启抓取')).toBe(true);

        for (const phase of ['paused', 'preparing', 'returning']) {
            render(state(phase, [7], { id: 12, eligible: true }, false));
            expect(actionButtons(mounted).some(value =>
                value.textContent === '开启抓取' || value.textContent === '关闭抓取')).toBe(false);
        }
    });
});
