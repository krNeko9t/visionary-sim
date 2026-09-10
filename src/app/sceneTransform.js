/**
 * Absolute calibration from source-scene coordinates into the physical world.
 *
 * The reference is measured once from every retained Gaussian centre. A
 * resolved transform never changes that reference and never consumes a prior
 * transformed result, so restoring a configuration cannot accumulate drift.
 */

const HALF_SQRT = Math.SQRT1_2;

/** Right-handed active rotations which carry the named source up axis to +Y. */
export const UP_AXIS_PRESETS = Object.freeze({
    '+Y': Object.freeze([0, 0, 0, 1]),
    '-Y': Object.freeze([1, 0, 0, 0]),
    '+Z': Object.freeze([-HALF_SQRT, 0, 0, HALF_SQRT]),
    '-Z': Object.freeze([HALF_SQRT, 0, 0, HALF_SQRT]),
    '+X': Object.freeze([0, 0, HALF_SQRT, HALF_SQRT]),
    '-X': Object.freeze([0, 0, -HALF_SQRT, HALF_SQRT])
});

export const DEFAULT_SCENE_CALIBRATION = Object.freeze({
    upAxis: '+Y',
    manualDegrees: Object.freeze([0, 0, 0]),
    longestMeters: 1,
    position: Object.freeze([0, 0, 0])
});

/**
 * Measure the immutable calibration reference from retained scene centres.
 *
 * @param {ArrayLike<number>} positions - Flat source-space xyz triples.
 * @returns {{min:number[],max:number[],center:number[],extent:number[],longest:number,count:number}}
 */
export function createSceneReference(positions) {
    if (!positions || positions.length === 0 || positions.length % 3 !== 0) {
        throw new Error('scene calibration needs at least one complete Gaussian centre');
    }
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let at = 0; at < positions.length; at += 3) {
        for (let axis = 0; axis < 3; axis++) {
            const value = positions[at + axis];
            if (!Number.isFinite(value)) {
                throw new Error('scene calibration centres must all be finite');
            }
            min[axis] = Math.min(min[axis], value);
            max[axis] = Math.max(max[axis], value);
        }
    }
    const extent = min.map((value, axis) => max[axis] - value);
    const longest = Math.max(...extent);
    if (!(longest > 0) || !Number.isFinite(longest)) {
        throw new Error('scene calibration reference must have a finite non-zero span');
    }
    return {
        min,
        max,
        center: min.map((value, axis) => value + extent[axis] * 0.5),
        extent,
        longest,
        count: positions.length / 3
    };
}

/**
 * Resolve one absolute configuration against a fixed source reference.
 * Manual angles rotate around fixed world X, then Y, then Z axes.
 *
 * @param {ReturnType<typeof createSceneReference>} reference
 * @param {{upAxis?:string,manualDegrees?:number[],longestMeters?:number,position?:number[]}} [input]
 */
export function resolveSceneTransform(reference, input = {}) {
    validateReference(reference);
    const config = {
        upAxis: input.upAxis ?? DEFAULT_SCENE_CALIBRATION.upAxis,
        manualDegrees: triple(input.manualDegrees ?? DEFAULT_SCENE_CALIBRATION.manualDegrees, 'manual angles'),
        longestMeters: input.longestMeters ?? DEFAULT_SCENE_CALIBRATION.longestMeters,
        position: triple(input.position ?? DEFAULT_SCENE_CALIBRATION.position, 'scene position')
    };
    const preset = UP_AXIS_PRESETS[config.upAxis];
    if (!preset) {
        throw new Error(`unknown source up axis "${config.upAxis}"`);
    }
    if (!Number.isFinite(config.longestMeters) || config.longestMeters <= 0) {
        throw new Error('scene longest edge must be a positive finite metre length');
    }

    const [x, y, z] = config.manualDegrees.map(degrees => degrees * Math.PI / 180);
    const manual = multiply(
        axisAngle([0, 0, 1], z),
        multiply(axisAngle([0, 1, 0], y), axisAngle([1, 0, 0], x))
    );
    const rotation = normalizeQuaternion(multiply(manual, preset));
    const rotationMatrix = quaternionMatrix(rotation);
    const scale = config.longestMeters / reference.longest;
    if (!Number.isFinite(scale) || scale <= 0) {
        throw new Error('derived scene calibration scale must be positive and finite');
    }
    const turnedCenter = rotate(rotation, reference.center.map(value => value * scale));
    const translation = config.position.map((value, axis) => value - turnedCenter[axis]);
    const matrix = [
        rotationMatrix[0] * scale, rotationMatrix[1] * scale, rotationMatrix[2] * scale, 0,
        rotationMatrix[3] * scale, rotationMatrix[4] * scale, rotationMatrix[5] * scale, 0,
        rotationMatrix[6] * scale, rotationMatrix[7] * scale, rotationMatrix[8] * scale, 0,
        translation[0], translation[1], translation[2], 1
    ];
    if (translation.some(value => !Number.isFinite(value)) || matrix.some(value => !Number.isFinite(value))) {
        throw new Error('scene calibration must produce a finite affine transform');
    }

    const toWorldDirection = direction => rotate(rotation, triple(direction, 'source direction'));
    const inverseRotation = conjugate(rotation);
    const toSourceDirection = direction => rotate(inverseRotation, triple(direction, 'world direction'));
    const toWorldPoint = (point) => {
        const local = triple(point, 'source point').map((value, axis) =>
            (value - reference.center[axis]) * scale
        );
        const turned = rotate(rotation, local);
        return turned.map((value, axis) => value + config.position[axis]);
    };
    const toSourcePoint = (point) => {
        const local = triple(point, 'world point').map((value, axis) => value - config.position[axis]);
        const turned = rotate(inverseRotation, local);
        return turned.map((value, axis) => value / scale + reference.center[axis]);
    };
    const transformPoints = (positions) => transformPositionArray(positions, toWorldPoint);
    const worldBounds = boundsOfCorners(reference, toWorldPoint);
    if ([...worldBounds.min, ...worldBounds.max, ...worldBounds.extent, ...worldBounds.center]
        .some(value => !Number.isFinite(value))) {
        throw new Error('scene calibration must produce finite world bounds');
    }

    return Object.freeze({
        reference,
        config: Object.freeze({
            upAxis: config.upAxis,
            manualDegrees: Object.freeze([...config.manualDegrees]),
            longestMeters: config.longestMeters,
            position: Object.freeze([...config.position])
        }),
        scale,
        rotation: Object.freeze(rotation),
        rotationMatrix: Object.freeze(rotationMatrix),
        translation: Object.freeze(translation),
        matrix: Object.freeze(matrix),
        determinant: determinant(rotationMatrix),
        worldBounds,
        toWorldPoint,
        toSourcePoint,
        toWorldDirection,
        toSourceDirection,
        transformPoints
    });
}

/**
 * State consequences of replacing one absolute calibration with another.
 * SI material inputs are deliberately absent: geometry scale invalidates
 * length-derived preparation, while density, modulus and Poisson ratio retain
 * their declared SI values.
 */
export function compareSceneTransforms(previous, next) {
    const lengthDerivedInvalid = previous.scale !== next.scale;
    const geometryChanged = previous.reference !== next.reference || lengthDerivedInvalid ||
        previous.config.upAxis !== next.config.upAxis ||
        previous.config.manualDegrees.some((value, axis) => value !== next.config.manualDegrees[axis]) ||
        previous.config.position.some((value, axis) => value !== next.config.position[axis]);
    return { geometryChanged, lengthDerivedInvalid };
}

/**
 * Transform the geometric fields of a cloud into calibrated world space.
 * Other fields, including SI material values and SH coefficients, are retained
 * by reference. Direction-dependent appearance can evaluate a world view ray
 * in source space through `transform.toSourceDirection`.
 *
 * @param {{count:number,positions:ArrayLike<number>,rotations:ArrayLike<number>,scales:ArrayLike<number>}} cloud
 * @param {ReturnType<typeof resolveSceneTransform>} transform
 */
export function transformCloudGeometry(cloud, transform) {
    const count = cloud?.count;
    if (!Number.isInteger(count) || count < 0 || cloud.positions?.length !== count * 3 ||
        cloud.scales?.length !== count * 3 || cloud.rotations?.length !== count * 4) {
        throw new Error('cloud geometry arrays do not match its count');
    }
    const positions = typedLike(cloud.positions, count * 3);
    const scales = typedLike(cloud.scales, count * 3);
    const rotations = typedLike(cloud.rotations, count * 4);
    for (let index = 0; index < count; index++) {
        write(positions, index * 3, transform.toWorldPoint(cloud.positions.slice(index * 3, index * 3 + 3)));
        for (let axis = 0; axis < 3; axis++) {
            const value = cloud.scales[index * 3 + axis];
            if (!Number.isFinite(value)) throw new Error('Gaussian scales must be finite');
            scales[index * 3 + axis] = value * transform.scale;
        }
        const sourceRotation = Array.from(cloud.rotations.slice(index * 4, index * 4 + 4));
        const worldRotation = normalizeQuaternion(multiply(transform.rotation, normalizeQuaternion(sourceRotation)));
        write(rotations, index * 4, worldRotation);
    }
    return { ...cloud, positions, scales, rotations };
}

function validateReference(reference) {
    if (!reference || !Number.isFinite(reference.longest) || reference.longest <= 0 ||
        !reference.center || reference.center.length !== 3 || !reference.extent || reference.extent.length !== 3 ||
        [...reference.center, ...reference.extent].some(value => !Number.isFinite(value))) {
        throw new Error('invalid fixed scene calibration reference');
    }
}

function triple(value, name) {
    if (!value || value.length !== 3 || Array.from(value).some(component => !Number.isFinite(component))) {
        throw new Error(`${name} must contain three finite numbers`);
    }
    return Array.from(value);
}

function typedLike(source, length) {
    return ArrayBuffer.isView(source) ? new source.constructor(length) : new Array(length);
}

function write(target, at, values) {
    for (let index = 0; index < values.length; index++) target[at + index] = values[index];
}

function transformPositionArray(source, transform) {
    if (!source || source.length % 3 !== 0) throw new Error('positions must be complete xyz triples');
    const result = typedLike(source, source.length);
    for (let at = 0; at < source.length; at += 3) {
        write(result, at, transform(source.slice(at, at + 3)));
    }
    return result;
}

function boundsOfCorners(reference, transform) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let bits = 0; bits < 8; bits++) {
        const source = reference.min.map((value, axis) => bits & (1 << axis) ? reference.max[axis] : value);
        const world = transform(source);
        world.forEach((value, axis) => {
            min[axis] = Math.min(min[axis], value);
            max[axis] = Math.max(max[axis], value);
        });
    }
    return Object.freeze({
        min: Object.freeze(min),
        max: Object.freeze(max),
        extent: Object.freeze(min.map((value, axis) => max[axis] - value)),
        center: Object.freeze(min.map((value, axis) => (value + max[axis]) * 0.5))
    });
}

function axisAngle(axis, angle) {
    const sine = Math.sin(angle * 0.5);
    return [axis[0] * sine, axis[1] * sine, axis[2] * sine, Math.cos(angle * 0.5)];
}

function multiply(a, b) {
    return [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
    ];
}

function normalizeQuaternion(q) {
    if (!q || q.length !== 4 || Array.from(q).some(value => !Number.isFinite(value))) {
        throw new Error('orientation must be a non-zero finite quaternion');
    }
    const length = Math.hypot(...q);
    if (!(length > 0)) throw new Error('orientation must be a non-zero finite quaternion');
    return Array.from(q, value => value / length);
}

function conjugate(q) {
    return [-q[0], -q[1], -q[2], q[3]];
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

function quaternionMatrix(q) {
    const [x, y, z, w] = q;
    return [
        1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
        2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
        2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)
    ];
}

function determinant(m) {
    return m[0] * (m[4] * m[8] - m[7] * m[5]) -
        m[3] * (m[1] * m[8] - m[7] * m[2]) +
        m[6] * (m[1] * m[5] - m[4] * m[2]);
}
