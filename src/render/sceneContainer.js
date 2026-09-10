/**
 * Scene-container state and display geometry without a renderer dependency.
 *
 * `relative` is the durable value: source-space position and dimensions, plus
 * orientation relative to scene calibration. `world` is its current projection.
 * Independent world edits are converted back to `relative`, which lets later
 * absolute scene calibration carry the container without cumulative drift.
 */

const MIN_AXIS_RATIO = 1e-6;

/** @param {object} reference @param {object} sceneTransform */
export function createSceneContainer(reference, sceneTransform) {
    const minimum = reference.longest * MIN_AXIS_RATIO;
    const relative = freezePose({
        position: reference.center,
        orientation: [0, 0, 0, 1],
        dimensions: reference.extent.map(value => Math.max(value, minimum))
    });
    return stateFromRelative(relative, sceneTransform);
}

/** Project the same durable container through a new absolute scene transform. */
export function followSceneCalibration(container, sceneTransform) {
    validateState(container);
    return stateFromRelative(container.relative, sceneTransform);
}

/**
 * Apply a world-space gizmo or numeric edit without changing scene geometry.
 * @param {object} container
 * @param {object} sceneTransform
 * @param {{position?:number[],orientation?:number[],dimensions?:number[]}} patch
 */
export function editSceneContainer(container, sceneTransform, patch) {
    validateState(container);
    const world = validatePose({ ...container.world, ...patch });
    const relative = freezePose({
        position: sceneTransform.toSourcePoint(world.position),
        orientation: multiply(conjugate(sceneTransform.rotation), world.orientation),
        dimensions: world.dimensions.map(value => value / sceneTransform.scale)
    });
    return stateFromRelative(relative, sceneTransform);
}

/**
 * Report retained scene centres outside the current oriented container.
 * @param {{position:number[],orientation:number[],dimensions:number[]}} pose
 * @param {ArrayLike<number>} positions - Flat world-space xyz triples.
 */
export function inspectSceneContainment(pose, positions) {
    const box = validatePose(pose);
    if (!positions || positions.length % 3 !== 0) throw new Error('scene positions must be xyz triples');
    const inverse = conjugate(box.orientation);
    const half = box.dimensions.map(value => value * 0.5);
    const epsilon = Math.max(...half) * 1e-10 + Number.EPSILON;
    const [qx, qy, qz, qw] = inverse;
    const [cx, cy, cz] = box.position;
    let outsideCount = 0;
    for (let at = 0; at < positions.length; at += 3) {
        const x = positions[at] - cx, y = positions[at + 1] - cy, z = positions[at + 2] - cz;
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw new Error('scene positions must be finite');
        const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
        if (Math.abs(x + qw * tx + qy * tz - qz * ty) > half[0] + epsilon ||
            Math.abs(y + qw * ty + qz * tx - qx * tz) > half[1] + epsilon ||
            Math.abs(z + qw * tz + qx * ty - qy * tx) > half[2] + epsilon) outsideCount++;
    }
    const totalCount = positions.length / 3;
    return {
        contained: outsideCount === 0,
        outsideCount,
        totalCount,
        warning: outsideCount ? `${outsideCount} of ${totalCount} scene centres are outside the container` : null
    };
}

/** Eight corners, twelve edges, and six inward-facing panels for display. */
export function containerGeometry(pose) {
    const box = validatePose(pose);
    const half = box.dimensions.map(value => value * 0.5);
    const corners = Array.from({ length: 8 }, (_, bits) => {
        const local = half.map((value, axis) => bits & (1 << axis) ? value : -value);
        return rotate(box.orientation, local).map((value, axis) => value + box.position[axis]);
    });
    const edges = [];
    for (let corner = 0; corner < 8; corner++) {
        for (let axis = 0; axis < 3; axis++) {
            const other = corner ^ (1 << axis);
            if (corner < other) edges.push([corner, other]);
        }
    }
    const faces = [];
    for (let axis = 0; axis < 3; axis++) {
        for (const sign of [-1, 1]) {
            const a = (axis + 1) % 3;
            const b = (axis + 2) % 3;
            const cornerAt = (aSign, bSign) => {
                let bits = sign > 0 ? (1 << axis) : 0;
                if (aSign > 0) bits |= 1 << a;
                if (bSign > 0) bits |= 1 << b;
                return bits;
            };
            const forward = [
                cornerAt(-1, -1), cornerAt(1, -1),
                cornerAt(1, 1), cornerAt(-1, 1)
            ];
            const indices = sign < 0 ? forward : [forward[0], forward[3], forward[2], forward[1]];
            const localNormal = [0, 0, 0];
            localNormal[axis] = -sign;
            faces.push({ corners: indices, inwardNormal: rotate(box.orientation, localNormal) });
        }
    }
    return { corners, edges, faces };
}

function stateFromRelative(relativeInput, sceneTransform) {
    if (!sceneTransform || !Number.isFinite(sceneTransform.scale) || sceneTransform.scale <= 0 ||
        typeof sceneTransform.toWorldPoint !== 'function') {
        throw new Error('container needs a resolved scene transform');
    }
    const relative = validatePose(relativeInput);
    const world = freezePose({
        position: sceneTransform.toWorldPoint(relative.position),
        orientation: multiply(sceneTransform.rotation, relative.orientation),
        dimensions: relative.dimensions.map(value => value * sceneTransform.scale)
    });
    return Object.freeze({ relative: freezePose(relative), world });
}

function validateState(container) {
    if (!container?.relative || !container?.world) throw new Error('invalid scene container state');
}

function validatePose(pose) {
    return {
        position: vector(pose?.position, 'container position', false),
        orientation: quaternion(pose?.orientation),
        dimensions: vector(pose?.dimensions, 'container dimensions', true)
    };
}

function freezePose(pose) {
    const valid = validatePose(pose);
    return Object.freeze({
        position: Object.freeze(valid.position),
        orientation: Object.freeze(valid.orientation),
        dimensions: Object.freeze(valid.dimensions)
    });
}

function vector(value, name, positive) {
    if (!value || value.length !== 3) throw new Error(`${name} must contain three numbers`);
    const result = Array.from(value);
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

function conjugate(q) {
    return [-q[0], -q[1], -q[2], q[3]];
}

function multiply(a, b) {
    return quaternion([
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
    ]);
}

function rotate(q, vector) {
    const [x, y, z, w] = q;
    const [vx, vy, vz] = vector;
    const tx = 2 * (y * vz - z * vy);
    const ty = 2 * (z * vx - x * vz);
    const tz = 2 * (x * vy - y * vx);
    return [
        vx + w * tx + y * tz - z * ty,
        vy + w * ty + z * tx - x * tz,
        vz + w * tz + x * ty - y * tx
    ];
}
