/** Dataset declarations, shared by runtime and offline tools; no I/O or engine. */
export const ALOCASIA = Object.freeze({
    name: 'alocasia', assetRoot: '/splats/alocasia', r: 0.016, elementSize: 0.016,
    material: Object.freeze({ maxStretch: 1.05, damping: 2 }),
    grab: Object.freeze({ law: 'compliant', responseTime: 0.003 }),
    requireFixedMaterial: true,
    preparation: Object.freeze({ heightMetres: 0.30, foregroundDistanceSource: 0.01,
        upMode: 'camera-up', upThresholdDegrees: 55,
        upReason: 'Accepted alocasia camera-up observation envelope; not a measurement of gravity.' })
});

export const HAT = Object.freeze({
    name: 'hat', assetRoot: '/splats/hat', r: 0.006, elementSize: 0.016,
    material: Object.freeze({ maxStretch: 1.05, damping: 2 }),
    grab: Object.freeze({ law: 'compliant', responseTime: 0.003 }),
    requireFixedMaterial: true,
    preparation: Object.freeze({ heightMetres: 0.30, foregroundDistanceSource: 0.01,
        upMode: 'projected-world-up', upThresholdDegrees: 25,
        upReason: 'Hat: all 207 frames provide projected world-up evidence (maximum 22.904 degrees); 25 degrees allows capture roll, while raw camera-up reaches 38.500 degrees with pitch. Not measured gravity.' })
});

export const CARNATIONS = Object.freeze({
    name: 'carnations', assetRoot: '/splats/carnations', r: 0.006, elementSize: 0.016,
    material: Object.freeze({ maxStretch: 1.05, damping: 2 }),
    grab: Object.freeze({ law: 'compliant', responseTime: 0.003 }),
    requireFixedMaterial: true,
    preparation: Object.freeze({ heightMetres: 0.30, foregroundDistanceSource: 0.01,
        upMode: 'projected-world-up', upThresholdDegrees: 55,
        upReason: 'Carnations: 202/209 frames provide projected world-up evidence (maximum 50.888 degrees); 55 degrees allows capture roll. Seven near-axis frames are indeterminate, including strong overhead views; raw camera-up reaches 91.699 degrees. Not measured gravity.' })
});

// Only ready scenes belong here. Subsequent tickets add their reviewed declarations.
const declarations = { alocasia: ALOCASIA, hat: HAT, carnations: CARNATIONS };
export function physdreamerDeclaration(name) {
    if (!Object.hasOwn(declarations, name)) throw new Error(`PhysDreamer scene ${name ?? '(missing)'} is not declared; known: ${Object.keys(declarations).join(', ')}`);
    return declarations[name];
}
