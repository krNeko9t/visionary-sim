import { POISSON_RANGE } from '../body/material.js';
import { SoftBody } from '../body/softBody.js';
import { discretizeBody } from '../sim/discretize/discretize.js';
import { resolveSceneTransform, transformCloudGeometry } from './sceneTransform.js';

/** Pure CPU preparation suitable for a dedicated module Worker. */
export function prepareSceneSimulation({
    instance, reference, calibration, material, resolution = 16
}, onProgress = () => {}) {
    validateMaterial(material);
    if (!Number.isInteger(instance?.id) || instance.id <= 0 || !instance.cloud) {
        throw new Error('simulation preparation needs one positive scene instance');
    }
    if (!Number.isInteger(resolution) || resolution < 1) {
        throw new Error('simulation resolution must be a positive integer');
    }

    onProgress({ phase: 'transform', message: '将实例几何变换到物理世界' });
    const transform = resolveSceneTransform(reference, calibration);
    const transformed = transformCloudGeometry(instance.cloud, transform);
    const cloud = {
        count: transformed.count,
        dimensionality: 2,
        positions: transformed.positions,
        rotations: transformed.rotations,
        scales: transformed.scales
    };
    const body = new SoftBody({
        name: instance.name ?? `instance-${instance.id}`,
        source: { kind: 'cloud', cloud },
        material,
        resolution
    });

    onProgress({ phase: 'discretize', message: '生成表面占据、近似体积与晶格' });
    const lattice = discretizeBody(body);
    const metrics = Object.freeze({
        occupiedCells: lattice.cells.length,
        nodes: lattice.nodeCount,
        volume: lattice.volume,
        mass: lattice.mass,
        resolution
    });
    onProgress({ phase: 'ready', message: 'CPU 模拟候体已准备', metrics });
    return { instanceId: instance.id, body, lattice, metrics };
}

function validateMaterial(material) {
    if (!material || !Number.isFinite(material.density) || material.density <= 0) {
        throw new Error('latest density must be a positive finite number');
    }
    if (!Number.isFinite(material.youngsModulus) || material.youngsModulus <= 0) {
        throw new Error('latest Young modulus must be a positive finite number');
    }
    if (!Number.isFinite(material.poissonRatio) ||
        material.poissonRatio < POISSON_RANGE.min || material.poissonRatio > POISSON_RANGE.max) {
        throw new Error(
            `latest Poisson ratio must be within ${POISSON_RANGE.min}..${POISSON_RANGE.max}`
        );
    }
}
