import { expect, it } from 'vitest';
import { mountLocalSceneConfiguration } from '../../src/ui/localSceneConfiguration.js';

class Element {
    children = [];
    listeners = new Map();
    attributes = {};
    append(...children) { this.children.push(...children); }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, fn) { this.listeners.set(name, fn); }
    removeEventListener(name) { this.listeners.delete(name); }
    remove() { this.removed = true; }
    click() { if (!this.disabled) return this.listeners.get('click')?.(); }
}

it('reads once on mount, exposes manual save and read, and detaches on disposal', async () => {
    let reads = 0, saves = 0, listener;
    const controller = {
        subscribe(fn) { listener = fn; fn({ busy: false, message: 'idle' }); return () => { listener = null; }; },
        async loadLocal() { reads++; },
        async saveLocal() { saves++; }
    };
    const host = new Element();
    const mounted = mountLocalSceneConfiguration(host, controller, { document: { createElement: () => new Element() } });
    await mounted.ready;
    const [save, read, status, guidance] = mounted.element.children;
    expect(reads).toBe(1);
    expect(saves).toBe(0);
    await save.click();
    expect(saves).toBe(1);
    listener({ busy: true, message: '正在保存' });
    expect(save.disabled).toBe(true);
    expect(read.disabled).toBe(true);
    expect(status.textContent).toBe('正在保存');
    listener({ busy: false, message: 'quota failure', detail: 'denied' });
    expect(status.textContent).toContain('denied');
    expect(guidance.textContent).toContain('JSON');
    await read.click();
    expect(reads).toBe(2);
    mounted.dispose();
    mounted.dispose();
    expect(listener).toBe(null);
    expect(mounted.element.removed).toBe(true);
    await save.click();
    expect(saves).toBe(1);
});
