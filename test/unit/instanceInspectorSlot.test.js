import { afterEach, describe, expect, it, vi } from 'vitest';

import { mountInstanceInspector } from '../../src/ui/instanceInspector.js';
import { mountSimulationControls } from '../../src/ui/simulationControls.js';

afterEach(() => vi.unstubAllGlobals());

class Element {
    constructor(tag) {
        this.tag = tag;
        this.children = [];
        this.className = '';
        this.classList = { add() {}, toggle() {} };
        this.dataset = {};
    }
    append(...children) {
        for (const child of children) {
            if (typeof child === 'string') this.textContent = `${this.textContent ?? ''}${child}`;
            else this.children.push(child);
        }
    }
    replaceChildren(...children) { this.children = [...children]; }
    addEventListener() {}
    setAttribute() {}
    remove() {}
    querySelector(selector) {
        const name = selector.startsWith('.') ? selector.slice(1) : null;
        for (const child of this.children) {
            if (name && child.className?.split(' ').includes(name)) return child;
            const nested = child.querySelector?.(selector);
            if (nested) return nested;
        }
        return null;
    }
}

describe('instance inspector extension slot', () => {
    it('keeps simulation controls mounted while selection rerenders details', () => {
        vi.stubGlobal('document', { createElement: tag => new Element(tag) });
        let emit;
        const empty = {
            selected: null, selectedId: null, instances: [], materialFields: [],
            colorMode: 'source', untracked: null
        };
        const materials = {
            subscribe(listener) { emit = listener; listener(empty); return () => {}; },
            selectInstance() {}, setColorMode() {}, setMaterialOverride() {}, clearMaterialOverride() {}
        };
        const root = new Element('root');
        const mounted = mountInstanceInspector({ root, materials });
        const slot = mounted.element.querySelector('.instance-simulation-slot');
        const marker = new Element('button');
        slot.append(marker);

        emit({ ...empty, selected: null });
        expect(mounted.element.querySelector('.instance-simulation-slot')).toBe(slot);
        expect(slot.children).toContain(marker);
    });

    it('shows overload and dropped physical time from the runtime clock', () => {
        vi.stubGlobal('document', { createElement: tag => new Element(tag) });
        const host = new Element('host');
        const application = {
            subscribe(listener) {
                listener({
                    scene: {}, inspection: { selected: null },
                    simulation: {
                        phase: 'running', participantIds: [7], metrics: [],
                        timing: { overloaded: true, backlogTime: 0.125, droppedTime: 0.25, maxStepsPerFrame: 24 }
                    }
                });
                return () => {};
            },
            pauseSimulation() {}, resumeSimulation() {}, returnToPreparation() {}
        };
        const mounted = mountSimulationControls({ host, application });
        expect(mounted.element.children[3].textContent)
            .toBe('模拟慢于现实时间 · 积压 0.125 s · 已丢时 0.250 s');
    });

    it('shows the real Worker stage and instance without inventing a percentage', () => {
        vi.stubGlobal('document', { createElement: tag => new Element(tag) });
        const host = new Element('host');
        const application = {
            subscribe(listener) {
                listener({
                    scene: {}, inspection: { selected: null },
                    simulation: {
                        phase: 'preparing', participantIds: [7], metrics: null, timing: null,
                        progress: { phase: 'discretize', instanceId: 7, message: '生成表面占据、近似体积与晶格' }
                    }
                });
                return () => {};
            },
            cancelSimulationPreparation() {}
        };
        const mounted = mountSimulationControls({ host, application });
        expect(mounted.element.children[1].textContent)
            .toBe('正在按需准备 · 1 个模拟实例 · ID 7 · 生成表面占据、近似体积与晶格');
        expect(mounted.element.children[1].textContent).not.toContain('%');
    });
});
