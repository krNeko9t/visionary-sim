import { cleanCloud } from '../assets/splats/clean.js';
import { createMetricRegion, splitCloudByRegion } from './metricRegion.js';

/** Shared runtime/offline preparation; no placement or resolution-dependent rule. */
export function prepareAlocasiaData(raw, samples, r) {
    const region = createMetricRegion(samples, r);
    if (!raw.positions.every(Number.isFinite)) {
        throw new Error('foreground positions must contain finite xyz coordinates');
    }
    const cloud = cleanCloud(raw);
    const { movable, fixed } = splitCloudByRegion(cloud, region);
    return { cloud, region, movable, fixed };
}
