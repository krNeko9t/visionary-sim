import { describe, expect, it, vi } from 'vitest';

import { createContainerEditor } from '../../src/ui/containerEditor.js';
import { createInteractionOwnership } from '../../src/ui/sceneSelection.js';

describe('container editing inputs', () => {
    const initial = {
        position: [0, 0, 0],
        orientation: [0, 0, 0, 1],
        dimensions: [1, 2, 3]
    };

    it('routes gizmo and numeric changes through one observable state', () => {
        const onChange = vi.fn();
        const editor = createContainerEditor(initial, { onChange });
        editor.updateFromGizmo({ position: [1, 2, 3] });
        editor.updateFromNumbers({ dimensions: [4, 5, 6], rotationDegrees: [0, 0, 90] });

        expect(editor.state()).toMatchObject({ position: [1, 2, 3], dimensions: [4, 5, 6] });
        expect(editor.state().orientation[2]).toBeCloseTo(Math.SQRT1_2, 12);
        expect(editor.state().orientation[3]).toBeCloseTo(Math.SQRT1_2, 12);
        expect(onChange).toHaveBeenNthCalledWith(1, expect.objectContaining({ position: [1, 2, 3] }), 'gizmo');
        expect(onChange).toHaveBeenNthCalledWith(2, expect.objectContaining({ dimensions: [4, 5, 6] }), 'numbers');
    });

    it('keeps the previous state when an input is empty or invalid', () => {
        const editor = createContainerEditor(initial);
        expect(() => editor.updateFromNumbers({ dimensions: [1, '', 2] })).toThrow('positive finite');
        expect(() => editor.updateFromGizmo({ position: [0, Number.NaN, 0] })).toThrow('finite');
        expect(editor.state()).toEqual(initial);
    });

    it('normalizes gizmo orientation to one orthogonal rotation', () => {
        const editor = createContainerEditor(initial);
        editor.updateFromGizmo({ orientation: [0, 0, 2, 2] });
        expect(editor.state().orientation[2]).toBeCloseTo(Math.SQRT1_2, 12);
        expect(editor.state().orientation[3]).toBeCloseTo(Math.SQRT1_2, 12);
    });
});

describe('pointer ownership', () => {
    it('gives a pointer to only one of camera, gizmo, selection, and grab', () => {
        const ownership = createInteractionOwnership();
        expect(ownership.claim(7, 'container-gizmo')).toBe(true);
        expect(ownership.claim(7, 'camera')).toBe(false);
        expect(ownership.ownerOf(7)).toBe('container-gizmo');
        expect(ownership.release(7, 'camera')).toBe(false);
        expect(ownership.release(7, 'container-gizmo')).toBe(true);
        expect(ownership.claim(7, 'selection')).toBe(true);
        ownership.clear();
        expect(ownership.ownerOf(7)).toBe(null);
    });
});
