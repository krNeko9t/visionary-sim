/**
 * One state channel shared by a 3D gizmo and numeric container inputs.
 * This module owns no DOM and no renderer object; adapters submit complete
 * values and receive an immutable snapshot through `onChange`.
 */

export function createContainerEditor(initial, { onChange = () => {} } = {}) {
    let current = validate(initial);

    const update = (patch, source) => {
        const candidate = { ...current, ...patch };
        if (patch.rotationDegrees !== undefined) {
            candidate.orientation = eulerQuaternion(patch.rotationDegrees);
            delete candidate.rotationDegrees;
        }
        const next = validate(candidate);
        onChange(snapshot(next), source);
        current = next;
        return snapshot(current);
    };

    return Object.freeze({
        state: () => snapshot(current),
        updateFromGizmo: patch => update(patch, 'gizmo'),
        updateFromNumbers: patch => update(patch, 'numbers'),
        replace: value => update(value, 'external')
    });
}

function validate(value) {
    return Object.freeze({
        position: Object.freeze(vector(value?.position, 'container position', false)),
        orientation: Object.freeze(quaternion(value?.orientation)),
        dimensions: Object.freeze(vector(value?.dimensions, 'container dimensions', true))
    });
}

function snapshot(value) {
    return {
        position: [...value.position],
        orientation: [...value.orientation],
        dimensions: [...value.dimensions]
    };
}

function vector(value, name, positive) {
    if (!value || value.length !== 3) throw new Error(`${name} must contain three numbers`);
    const result = Array.from(value, component => typeof component === 'number' ? component : Number.NaN);
    if (result.some(component => !Number.isFinite(component) || (positive && component <= 0))) {
        throw new Error(`${name} must contain ${positive ? 'positive finite' : 'finite'} numbers`);
    }
    return result;
}

function quaternion(value) {
    if (!value || value.length !== 4 || Array.from(value).some(component => !Number.isFinite(component))) {
        throw new Error('container orientation must be a non-zero finite quaternion');
    }
    const length = Math.hypot(...value);
    if (!(length > 0)) throw new Error('container orientation must be a non-zero finite quaternion');
    return Array.from(value, component => component / length);
}

function eulerQuaternion(degrees) {
    const [x, y, z] = vector(degrees, 'container rotation', false).map(value => value * Math.PI / 180);
    const qx = [Math.sin(x / 2), 0, 0, Math.cos(x / 2)];
    const qy = [0, Math.sin(y / 2), 0, Math.cos(y / 2)];
    const qz = [0, 0, Math.sin(z / 2), Math.cos(z / 2)];
    return multiply(qz, multiply(qy, qx));
}

function multiply(a, b) {
    return quaternion([
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
    ]);
}
