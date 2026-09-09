import { SoftBody } from './softBody.js';

/** Convert one retained upstream instance to a surface cloud in a rigid solver frame. */
export function benchBody(view, matrix, rotation, scale) {
    const p = view.properties, count = view.count;
    const positions = new Float32Array(count * 3), rotations = new Float32Array(count * 4);
    const scales = new Float32Array(count * 3);
    const [ax, ay, az, aw] = rotation;
    for (let i = 0; i < count; i++) {
        const x=p.x[i], y=p.y[i], z=p.z[i];
        positions.set([matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12],
            matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13],
            matrix[2]*x+matrix[6]*y+matrix[10]*z+matrix[14]], i*3);
        const bx=p.rot_1[i], by=p.rot_2[i], bz=p.rot_3[i], bw=p.rot_0[i];
        const q=[aw*bx+ax*bw+ay*bz-az*by, aw*by-ax*bz+ay*bw+az*bx,
            aw*bz+ax*by-ay*bx+az*bw, aw*bw-ax*bx-ay*by-az*bz];
        const length=Math.hypot(...q);
        if (!(length>0)) throw new Error('实例包含无效旋转');
        rotations.set(q.map(v=>v/length),i*4);
        scales.set([Math.exp(p.scale_0[i])*scale,Math.exp(p.scale_1[i])*scale,0],i*3);
    }
    const row=view.physics;
    if(!row||!Number.isFinite(row.rho_si)||row.rho_si<=0||!Number.isFinite(row.E_si)||row.E_si<=0||!Number.isFinite(row.nu_si)||row.nu_si<0||row.nu_si>=.5)throw new Error('请先补齐有效物性');
    return new SoftBody({name:view.name,source:{kind:'cloud',cloud:{count,positions,rotations,scales}},resolution:16,
        material:{density:row.rho_si,youngsModulus:row.E_si,poissonRatio:row.nu_si}});
}
