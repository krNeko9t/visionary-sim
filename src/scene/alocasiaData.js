import { cleanCloud } from '../assets/splats/clean.js';
import { createMetricRegion, extendMaterialRegion, splitCloudByRegion } from './metricRegion.js';

/** Shared runtime/offline preparation; no placement or resolution-dependent rule. */
export function prepareAlocasiaData(raw, samples, r) {
    const measured = createMetricRegion(samples, r);
    const cloud = cleanAlocasiaCloud(raw, 'foreground');
    const { movable, fixed } = splitCloudByRegion(cloud, measured);
    const region = extendMaterialRegion(cloud.positions, measured);
    return { cloud, region, movable, fixed };
}

/** The same opacity rule applies to both offline partitions, without placement. */
export function cleanAlocasiaCloud(raw, label) {
    for (const [key, stride] of Object.entries({ positions: 3, rotations: 4, scales: 3, colors: 3, opacity: 1 })) {
        if (raw[key]?.length !== raw.count * stride || !raw[key].every(Number.isFinite)) {
            throw new Error(`${label} ${key} must contain finite, complete Gaussian attributes`);
        }
    }
    return cleanCloud(raw);
}
