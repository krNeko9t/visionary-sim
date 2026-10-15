export function checkPhysDreamerUp(data, { mode = 'camera-up', thresholdDegrees, reason }) {
    if (!['camera-up', 'projected-world-up'].includes(mode)) throw new Error('unknown up check mode');
    if (!Number.isFinite(thresholdDegrees) || thresholdDegrees < 0 || thresholdDegrees >= 90) throw new Error('--up-threshold-deg must be in [0, 90)');
    if (typeof reason !== 'string' || !reason.trim()) throw new Error('up check requires a reason');
    if (!Array.isArray(data.frames) || !data.frames.length) throw new Error('camera poses require nonempty frames');
    const frames = data.frames.map((frame, i) => {
        const m = frame.transform_matrix;
        if (!Array.isArray(m) || m.length !== 4 || m.some(row => !Array.isArray(row) || row.length !== 4 || !row.every(Number.isFinite))) throw new Error(`invalid camera pose ${i}`);
        if (m[3].some((v, j) => Math.abs(v - (j === 3 ? 1 : 0)) > 1e-6)) throw new Error(`invalid camera homogeneous row ${i}`);
        const columns = [0, 1, 2].map(j => [m[0][j], m[1][j], m[2][j]]);
        const dot = (a, b) => a.reduce((sum, v, j) => sum + v * b[j], 0);
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if (Math.abs(dot(columns[a], columns[b]) - (a === b ? 1 : 0)) > 1e-4) throw new Error(`camera rotation must be orthonormal at ${i}`);
        const [a, b, c] = columns;
        const determinant = a[0] * (b[1] * c[2] - b[2] * c[1]) - b[0] * (a[1] * c[2] - a[2] * c[1]) + c[0] * (a[1] * b[2] - a[2] * b[1]);
        if (Math.abs(determinant - 1) > 1e-4) throw new Error(`camera rotation must be right-handed at ${i}`);
        const rawDeviationDegrees = Math.acos(Math.max(-1, Math.min(1, b[2] / Math.hypot(...b)))) * 180 / Math.PI;
        // World +Z projected onto the image plane. A near optical-axis up has
        // no reliable image direction, independent of its measured roll angle.
        const projectionLength = Math.hypot(a[2], b[2]);
        const projectedDeviationDegrees = projectionLength > 1e-12
            ? Math.acos(Math.max(-1, Math.min(1, b[2] / projectionLength))) * 180 / Math.PI : null;
        const informative = projectionLength >= 0.5;
        return { index: i, filePath: frame.file_path ?? null, matrixValid: true,
            rawDeviationDegrees, projectionLength, projectedDeviationDegrees,
            used: mode === 'camera-up' || informative,
            exclusionReason: mode === 'projected-world-up' && !informative ? 'world up projects to less than 0.5; strong pitch gives uncertain image-up evidence' : null };
    });
    const used = frames.filter(frame => frame.used);
    if (!used.length) throw new Error('no informative camera up evidence; declared world +Z cannot be checked from these poses');
    const angles = frames.map(frame => frame.rawDeviationDegrees);
    const maxDeviationDegrees = Math.max(...angles);
    const maxCheckedDeviationDegrees = Math.max(...used.map(frame => mode === 'camera-up' ? frame.rawDeviationDegrees : frame.projectedDeviationDegrees));
    if (maxCheckedDeviationDegrees > thresholdDegrees) throw new Error(`camera up deviation ${maxCheckedDeviationDegrees} degrees exceeds threshold ${thresholdDegrees} (${mode}; declared source +Z)`);
    return { convention: 'OpenGL/Blender camera-to-world; +Y camera up = rotation column 1', declaredSourceUp: [0, 0, 1],
        mode, reason, criterion: mode === 'camera-up' ? 'all raw camera-up angles within threshold' : 'all frames with world-up projection length >= 0.5 within projected angle threshold; at least one required',
        limitation: 'Pose compatibility with declared source +Z, not measured gravity; excluded frames provide no up evidence.',
        frameCount: frames.length, usedFrameCount: used.length, excludedFrameCount: frames.length - used.length,
        thresholdDegrees, maxDeviationDegrees, maxCheckedDeviationDegrees, perFrameDeviationDegrees: angles, frames };
}
