import { readPly } from './splats/ply.js';

// Exact upstream NPZ fixture, read in the browser. No row reordering before labels.
async function labelsFromNpz(buffer) {
    const v = new DataView(buffer), bytes = new Uint8Array(buffer), decoder = new TextDecoder();
    let end = buffer.byteLength - 22;
    while (end >= Math.max(0, buffer.byteLength - 65557) && v.getUint32(end, true) !== 0x06054b50) end--;
    if (end < 0) throw new Error('labels.npz 缺少 ZIP 目录');
    let at = v.getUint32(end + 16, true);
    for (let n = 0; n < v.getUint16(end + 10, true); n++) {
        if (v.getUint32(at, true) !== 0x02014b50) throw new Error('NPZ 目录损坏');
        const method = v.getUint16(at + 10, true), size = v.getUint32(at + 20, true);
        const nameSize = v.getUint16(at + 28, true), extra = v.getUint16(at + 30, true), comment = v.getUint16(at + 32, true);
        const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameSize));
        if (name === 'labels.npy') {
            const local = v.getUint32(at + 42, true);
            const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
            let data = bytes.slice(start, start + size);
            if (method === 8) data = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
            else if (method !== 0) throw new Error('不支持该 NPZ 压缩方式');
            const nv = new DataView(data.buffer), major = data[6], offset = major === 1 ? 10 : 12;
            const length = major === 1 ? nv.getUint16(8, true) : nv.getUint32(8, true);
            const header = decoder.decode(data.subarray(offset, offset + length));
            if (!header.includes("'<i4'") || !header.includes('False')) throw new Error('原型要求 labels 为 little-endian int32、C 顺序');
            return new Int32Array(data.buffer.slice(offset + length));
        }
        at += 46 + nameSize + extra + comment;
    }
    throw new Error('NPZ 中没有 labels.npy');
}

export async function prepareBench(plyBuffer, npzBuffer, physics, progress = () => {}) {
    progress('解码 PLY，保留完整高斯与球谐颜色…');
    const names = ['x','y','z','f_dc_0','f_dc_1','f_dc_2','opacity','scale_0','scale_1','rot_0','rot_1','rot_2','rot_3', ...Array.from({length:45},(_,i)=>`f_rest_${i}`)];
    const { count, properties: p } = readPly(plyBuffer, { properties: names });
    const labels = await labelsFromNpz(npzBuffer);
    if (labels.length !== count) throw new Error(`标签 ${labels.length} 与高斯 ${count} 不匹配`);
    const counts = new Map(), rows = new Map(physics.rows.map(row => [row.instance_id, row]));
    if (rows.size !== physics.rows.length) throw new Error('物性 ID 重复');
    for (const id of labels) { if (id < 0) throw new Error('负实例 ID'); counts.set(id, (counts.get(id) ?? 0) + 1); }
    for (const [id, row] of rows) if (row.n_gau !== undefined && row.n_gau !== (counts.get(id) ?? 0)) throw new Error(`实例 ${id} 高斯计数不匹配`);
    const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
    for(let i=0;i<count;i++) for(let k=0;k<3;k++) {const value=p[['x','y','z'][k]][i];if(!Number.isFinite(value))throw new Error('存在非有限中心，未静默删除');min[k]=Math.min(min[k],value);max[k]=Math.max(max[k],value);}
    const center=min.map((v,k)=>(v+max[k])/2), span=Math.max(...min.map((v,k)=>max[k]-v));
    if (!Number.isFinite(span) || span<=0) throw new Error('无有效场景范围');
    progress('按原始行标签组织实例，统一场景尺度…');
    const groups = [...counts].sort((a,b)=>a[0]-b[0]).map(([id,n])=>({id,count:n,name:physics.meta?.names?.[id] ?? (id===0?'未追踪内容':`实例 ${id}`),physics:rows.get(id)??null,properties:Object.fromEntries(names.map(key=>[key,new Float32Array(n)])),min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]}));
    const byId=new Map(groups.map(g=>[g.id,g])), offsets=new Map(groups.map(g=>[g.id,0]));
    for(let i=0;i<count;i++) {const id=labels[i],g=byId.get(id),j=offsets.get(id);for(const key of names)g.properties[key][j]=p[key][i];for(let k=0;k<3;k++){const key=['x','y','z'][k],value=(p[key][i]-center[k])/span;g.properties[key][j]=value;g.min[k]=Math.min(g.min[k],value);g.max[k]=Math.max(g.max[k],value);}g.properties.scale_0[j]-=Math.log(span);g.properties.scale_1[j]-=Math.log(span);offsets.set(id,j+1);}
    for(const g of groups)g.properties.scale_2=new Float32Array(g.count).fill(-Infinity); // zero third axis; 2DGS uses the two tangent axes
    return {count,center,span,min:min.map((v,k)=>(v-center[k])/span),max:max.map((v,k)=>(v-center[k])/span),groups};
}
