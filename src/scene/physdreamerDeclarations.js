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

// Only ready scenes belong here. Subsequent tickets add their reviewed declarations.
const declarations = { alocasia: ALOCASIA };
export function physdreamerDeclaration(name) {
    if (!Object.hasOwn(declarations, name)) throw new Error(`PhysDreamer scene ${name ?? '(missing)'} is not declared; known: ${Object.keys(declarations).join(', ')}`);
    return declarations[name];
}
