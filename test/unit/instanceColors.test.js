import { expect, it, vi } from 'vitest';

import { applyInstanceColors, registerInstanceColorModifier } from '../../src/render/instanceColors.js';

it('updates a deforming splat without replacing its combined work-buffer modifier', () => {
    const component = {
        setWorkBufferModifier: vi.fn(),
        setParameter: vi.fn()
    };
    registerInstanceColorModifier(component);

    applyInstanceColors([{ id: 7, entity: { gsplat: component } }], {
        colorMode: 'instances', selectedId: 7
    });

    expect(component.setWorkBufferModifier).not.toHaveBeenCalled();
    expect(component.setParameter).toHaveBeenCalledWith('inspectionMix', 1);
    expect(component.setParameter).toHaveBeenCalledWith(
        'inspectionColor', new Float32Array([1, 0.75, 0.2])
    );
});
