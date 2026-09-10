/** Static rigid box data consumed by the world-space solver. */

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function finiteVector(value, length, name) {
    if (!value || value.length !== length || [...value].some(component => !Number.isFinite(component))) {
        throw new Error(`${name} must contain ${length} finite numbers`);
    }
    return [...value];
}

function rotationFromQuaternion(value) {
    const [x0, y0, z0, w0] = finiteVector(value, 4, 'container orientation');
    const length = Math.hypot(x0, y0, z0, w0);
    if (!(length > 0)) {
        throw new Error('container orientation must be a non-zero finite quaternion');
    }
    const x = x0 / length;
    const y = y0 / length;
    const z = z0 / length;
    const w = w0 / length;
    const xx = x * x;
    const yy = y * y;
    const zz = z * z;
    const xy = x * y;
    const xz = x * z;
    const yz = y * z;
    const wx = w * x;
    const wy = w * y;
    const wz = w * z;
    return [
        1 - 2 * (yy + zz), 2 * (xy + wz), 2 * (xz - wy),
        2 * (xy - wz), 1 - 2 * (xx + zz), 2 * (yz + wx),
        2 * (xz + wy), 2 * (yz - wx), 1 - 2 * (xx + yy)
    ];
}

/**
 * Converts either a scene container or the existing axis-aligned tank into
 * one immutable solver frame. Scene dimensions are full internal lengths.
 * Legacy tanks stay open at +Y; scene containers are six-sided.
 */
export function solverContainerFrame(container) {
    if (container?.min && container?.max) {
        const min = finiteVector(container.min, 3, 'tank min');
        const max = finiteVector(container.max, 3, 'tank max');
        const dimensions = max.map((value, axis) => value - min[axis]);
        if (dimensions.some(value => !(value > 0))) {
            throw new Error('tank dimensions must be positive finite numbers');
        }
        return {
            position: min.map((value, axis) => (value + max[axis]) * 0.5),
            halfSize: dimensions.map(value => value * 0.5),
            rotation: [...IDENTITY],
            closedTop: container.closedTop ?? false
        };
    }

    const position = finiteVector(container?.position, 3, 'container position');
    const dimensions = finiteVector(container?.dimensions, 3, 'container dimensions');
    if (dimensions.some(value => !(value > 0))) {
        throw new Error('container dimensions must be positive finite numbers');
    }
    return {
        position,
        halfSize: dimensions.map(value => value * 0.5),
        rotation: rotationFromQuaternion(container.orientation),
        closedTop: true
    };
}

function rotate(rotation, vector) {
    return [
        rotation[0] * vector[0] + rotation[3] * vector[1] + rotation[6] * vector[2],
        rotation[1] * vector[0] + rotation[4] * vector[1] + rotation[7] * vector[2],
        rotation[2] * vector[0] + rotation[5] * vector[1] + rotation[8] * vector[2]
    ];
}

function inverseRotate(rotation, vector) {
    return [
        rotation[0] * vector[0] + rotation[1] * vector[1] + rotation[2] * vector[2],
        rotation[3] * vector[0] + rotation[4] * vector[1] + rotation[5] * vector[2],
        rotation[6] * vector[0] + rotation[7] * vector[1] + rotation[8] * vector[2]
    ];
}

export function toContainerPoint(frame, point) {
    return inverseRotate(frame.rotation, point.map((value, axis) => value - frame.position[axis]));
}

export function toWorldPoint(frame, point) {
    return rotate(frame.rotation, point).map((value, axis) => value + frame.position[axis]);
}

export function limitPointToContainer(frame, point) {
    const local = toContainerPoint(frame, point);
    for (let axis = 0; axis < 3; axis++) {
        local[axis] = Math.max(-frame.halfSize[axis], Math.min(frame.halfSize[axis], local[axis]));
    }
    return toWorldPoint(frame, local);
}

export function containerWorldBounds(frame) {
    const half = [0, 1, 2].map(axis =>
        Math.abs(frame.rotation[axis]) * frame.halfSize[0] +
        Math.abs(frame.rotation[3 + axis]) * frame.halfSize[1] +
        Math.abs(frame.rotation[6 + axis]) * frame.halfSize[2]);
    return {
        min: half.map((value, axis) => frame.position[axis] - value),
        max: half.map((value, axis) => frame.position[axis] + value)
    };
}

function resolvePlane(position, previous, normal, depth, friction) {
    if (depth <= 0) {
        return position;
    }
    const result = position.map((value, axis) => value + normal[axis] * depth);
    const delta = result.map((value, axis) => value - previous[axis]);
    const normalDistance = delta.reduce((sum, value, axis) => sum + value * normal[axis], 0);
    const tangent = delta.map((value, axis) => value - normal[axis] * normalDistance);
    const tangentLength = Math.hypot(...tangent);
    if (tangentLength > 1e-9) {
        const fraction = Math.min(1, friction * depth / tangentLength);
        for (let axis = 0; axis < 3; axis++) {
            result[axis] -= tangent[axis] * fraction;
        }
    }
    return result;
}

/** CPU reference for the static box contact implemented by finalize.wgsl. */
export function resolveContainerContact(frame, position, previous, friction) {
    const p0 = toContainerPoint(frame, position);
    const previousLocal = toContainerPoint(frame, previous);
    const h = frame.halfSize;
    // Keep this order identical to finalize.wgsl. With friction, resolving one
    // face changes the tangential displacement seen by every later face.
    let p = resolvePlane(p0, previousLocal, [0, 1, 0], -h[1] - p0[1], friction);
    p = resolvePlane(p, previousLocal, [1, 0, 0], -h[0] - p[0], friction);
    p = resolvePlane(p, previousLocal, [-1, 0, 0], p[0] - h[0], friction);
    p = resolvePlane(p, previousLocal, [0, 0, 1], -h[2] - p[2], friction);
    p = resolvePlane(p, previousLocal, [0, 0, -1], p[2] - h[2], friction);
    if (frame.closedTop) {
        p = resolvePlane(p, previousLocal, [0, -1, 0], p[1] - h[1], friction);
    }
    return toWorldPoint(frame, p);
}
