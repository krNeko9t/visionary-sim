import { expect, it } from 'vitest';
import { checkPhysDreamerUp } from '../../tools/physdreamerUp.js';

// Right-handed camera: world +Z is image up at pitch=0, optical axis at 90.
function pose(pitch = 0, roll = 0) {
    const p = pitch * Math.PI / 180, r = roll * Math.PI / 180;
    const x = [1, 0, 0], y = [0, Math.sin(p), Math.cos(p)], z = [0, -Math.cos(p), Math.sin(p)];
    const a = x.map((v, i) => v * Math.cos(r) + y[i] * Math.sin(r));
    const b = y.map((v, i) => v * Math.cos(r) - x[i] * Math.sin(r));
    return { file_path: `pitch-${pitch}-roll-${roll}`, transform_matrix: [...a.map((_, i) => [a[i], b[i], z[i], 0]), [0, 0, 0, 1]] };
}
const check = (frames, mode = 'projected-world-up', thresholdDegrees = 25) => checkPhysDreamerUp({ frames }, { mode, thresholdDegrees, reason: 'Synthetic observed envelope' });
it('separates pitch from image roll, retains every raw angle and labels uncertain evidence', () => {
    const report = check([pose(), pose(50, 20), pose(92)]);
    expect(report.usedFrameCount).toBe(2);
    expect(report.excludedFrameCount).toBe(1);
    expect(report.maxDeviationDegrees).toBeCloseTo(92);
    expect(report.maxCheckedDeviationDegrees).toBeCloseTo(20);
    expect(report.frames[2]).toMatchObject({ matrixValid: true, used: false, exclusionReason: expect.stringContaining('0.5') });
    expect(report.perFrameDeviationDegrees).toHaveLength(3);
    expect(() => check([pose(50)], 'camera-up', 55)).not.toThrow();
    expect(() => check([pose(60)], 'camera-up', 55)).toThrow(/exceeds threshold 55/);
});
it('rejects roll, inverted up, a wrong source axis, and absent up evidence for different reasons', () => {
    expect(() => check([pose(), pose(10, 40)])).toThrow(/exceeds threshold/);
    expect(() => check([pose(0, 180)])).toThrow(/exceeds threshold/);
    expect(() => check([pose(90)])).toThrow(/no informative/);
    expect(() => check([])).toThrow(/nonempty/);
    // Identity camera declares world Y image up, incompatible with the source +Z declaration.
    expect(() => check([{ transform_matrix: [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]] }])).toThrow(/no informative/);
});
it('checks matrix legality before deciding a frame is uninformative', () => {
    const invalid = pose(90); invalid.transform_matrix[0][0] = 2;
    expect(() => check([pose(), invalid])).toThrow(/orthonormal/);
    const reflected = pose(); reflected.transform_matrix[0][0] = -1;
    expect(() => check([reflected])).toThrow(/right-handed/);
});
