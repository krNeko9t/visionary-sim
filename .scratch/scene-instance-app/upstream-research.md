# bench 上游数据契约调查

2026-09-09；对应「上游数据的几何、实例对应与物性契约是什么」。只读调查；未运行流水线，未修改数据。本文记录事实、推论与未决项，不替后续 HITL 票选择二维输入策略。

## 结论与边界

消费现有实例与物性时，可从三件套取得必要字段：源场景 `point_cloud.ply`、结果 `labels.npz`、`instance_physics.json`。图像、COLMAP 相机、特征 PT、模型权重是上游生成/复核材料，不是读取已导出实例物性的必需输入。这是依据字段完整性的推论，并非已实现或测试过的浏览器加载方案。

**此样本按上游代码契约是 2DGS / surfel 输入。** 两个 scale 不是一个已知缺失的第三轴。上游脚本消费已有 PLY，并不训练/生成它；本次未找到能证明原始训练器版本或真实厚度的记录。不能用上游 CLI 中笼统的 “3DGS” 描述推翻实际字段及后端选择。[后端选择](/home/liaowanjun/Projects/AnySplat/src/trace_render/trace_rasterize.py:23) 明确将两轴归为 surfel、三轴归为 3dgs。现场 PLY 只有 `scale_0,scale_1`；无实体网格、厚度、质量或体积字段。补轴、曲面重建或代理实体均仍是决策，不是解析步骤。

## 实例索引与可验证程度

[PLY 读取器](/home/liaowanjun/Projects/AnySplat/src/coord/ply_io.py:204) 按 vertex 行直接堆叠坐标与属性；[追踪器](/home/liaowanjun/Projects/AnySplat/scripts/trace_instance_to_gaussians.py:1962) 用同一 N 行几何分配累加数组，[辅助流逐视角核对](/home/liaowanjun/Projects/AnySplat/scripts/trace_instance_to_gaussians.py:2083) 要求物性与主流 `num_ray` 完全相等。[保存契约](/home/liaowanjun/Projects/AnySplat/scripts/trace_instance_to_gaussians.py:2203) 明确 full-length 特征与 `num_ray` 都按原始高斯索引排列；`gaussian_index` 只是有效子集到原始行的索引。

[聚类导出](/home/liaowanjun/Projects/AnySplat/scripts/run_iggt_phys_pipeline.py:124) 定义 `valid = num_ray > 0`，创建全 N 长 labels，以 `labels[valid] = lab + 1` 写回。0 = 未追踪，不是“背景物体”；valid=false 不表示 PLY 几何无效或不可渲染。[HDBSCAN 包装](/home/liaowanjun/Projects/AnySplat/src/instseg/hdbscan_assign.py:71) 通过最近质心给所有有效点赋类，连初始 noise 也有标签；没有独立 -1 未分类类。墙、地板本身具有正常正整数 ID。

现场校验：N = 1,045,236；labels 为 int32[N]，valid 为 bool[N]；全部满足 `valid == (labels > 0)`；九条物性行的 `n_gau` 与标签直方图逐项相等。

| ID | 名称（JSON meta.names） | 数量 |
|---|---|---:|
| 0 | 未追踪（无物性行） | 39,528 |
| 1 | cat figurine | 27,402 |
| 2 | egg tart | 6,847 |
| 3 | doll | 18,876 |
| 4 | toy car | 13,434 |
| 5 | fragment (not an object) | 1,025 |
| 6 | grapes | 7,581 |
| 7 | grape leaf | 7,840 |
| 8 | wall [stuff] | 555,810 |
| 9 | deck floor [stuff] | 366,893 |

这些校验能发现长度、ID、数量不一致，**不能证明任意同 N、同直方图文件未被重排或替换**。NPZ 只有 labels/valid/params；JSON 记录历史绝对路径而非 PLY 内容哈希。当前流程还允许复用已有 labels 与缓存（[聚类复用](/home/liaowanjun/Projects/AnySplat/scripts/run_iggt_phys_pipeline.py:115)、[外部 labels](/home/liaowanjun/Projects/AnySplat/scripts/run_iggt_phys_pipeline.py:369)），没有由这两个导出文件提供的端到端内容身份保证。本次没有运行渲染核验或重新追踪。

## 几何编码、坐标与体积

现场 PLY：binary_little_endian；77 个 float32 属性，每行 308 字节；x/y/z、全零 nx/ny/nz、3 DC、45 rest SH、opacity、2 scale、4 rotation、16 segfeat。无 comment，无坐标、上方向或单位元数据。全部原始 float 有限。上游 [激活函数及四元数](/home/liaowanjun/Projects/AnySplat/src/coord/ply_io.py:210)：scale 指数激活，opacity sigmoid，rotation 为 wxyz 且归一化；[颜色](/home/liaowanjun/Projects/AnySplat/src/coord/ply_io.py:231) 读取 SH，预览 RGB 只用 `clamp(0.5 + 0.28209479 * DC)`。45 rest 对应常见 degree-3 容量，但原始训练器/所有 SH 布局的生成来源未核验。segfeat 不等同最终实例 ID，导出 labels 才是本流水线的聚类结果。

原始中心范围：x [-13.07031, 13.72701]、y [-7.20748, 5.09664]、z [4.96709, 13.46878]；这些是文件单位，不能报告为米。激活 scale_0 min/median/max = 1.13963e-6 / 0.0199239 / 10.8901；scale_1 = 1.04653e-6 / 0.0150461 / 4.41334。大 scale 与离群内容使直接取范围作为实体包围/体积尤其缺乏依据。

[读取器](/home/liaowanjun/Projects/AnySplat/src/coord/ply_io.py:188) 在缺失 convention 时保留 None；[trace 包装](/home/liaowanjun/Projects/AnySplat/src/trace_render/trace_rasterize.py:69) 用 OpenCV 作日志默认值，未对 means 做世界朝向修正。场景含 `sparse/0/{cameras,images,points3D}.bin`；[COLMAP 加载器](/home/liaowanjun/Projects/AnySplat/src/trace_cameras/load_colmap.py:28) 明确外参是世界到相机，并转换像素中心约定。这说明相机读取规则，不证明世界 z-up、y-up、地面水平或米制尺度。预设命名不能把相机坐标约定当世界重力方向。

仅有表面高斯和材料参数不能唯一决定闭合实体、体积或质量（推论）。当前 [cloudVolume](/home/liaowanjun/Projects/simulation/try_off1/claude/src/sim/discretize/cloudVolume.js:195) 依赖三轴椭球；因此现有体积路径直接消费此样本的可行性尚未成立。没有实测 voxelization、模拟稳定性或性能。

## 物性字段

[实例输出](/home/liaowanjun/Projects/AnySplat/scripts/run_iggt_phys_pipeline.py:209) 按 labels 的正整数 ID 池化追踪特征，再解码；JSON 的 `rows[].instance_id` 是关联键，显示名称在 `meta.names` 的字符串 ID 键。`rho_si` = kg/m³，`E_si` = Pa，`nu_si` 无量纲；顺序由 [meta.property_order](/home/liaowanjun/Projects/AnySplat/scripts/run_iggt_phys_pipeline.py:393) 明示。现场九行无这些字段缺失，rho 范围 122.811–2193.846，E 范围 2.549e6–2.491e10，nu 范围 0.25870–0.44663；这些是模型推断值，不是测量认证值。

[decode](/home/liaowanjun/Projects/AnySplat/scripts/run_iggt_phys_pipeline.py:186) 给出模型 z 空间 mu、正 variance；`var` 不是 SI 方差，更不是置信概率。`mu_spread` 是同一实例各高斯单独解码 mu 的总体标准差，仍在 z 空间，不能当整体参数误差条。[反归一化](/home/liaowanjun/Projects/AnySplat/src/dataset/physics/parsers.py:81) 对密度与 E 用 log10 逆变换，nu 用线性逆变换。SI 字段已导出，消费者无需重复依赖训练归一化常数。

[表格 writer](/home/liaowanjun/Projects/AnySplat/scripts/run_iggt_phys_pipeline.py:274) 的 `trust=LOW(small)` 仅由 `n_gau < small_instance_threshold` 决定，JSON 不直接保存 trust；阈值为 2000，所以只有 ID 5 命中。大于阈值的 `ok` 不是准确性保证。缺失/不合法物性的一般导入行为仍需规格规定，当前样本不能覆盖这些情况。

## 大小、最低数组成本与现有入口风险

| 内容 | 文件字节 |
|---|---:|
| point_cloud.ply | 321,934,603 |
| labels.npz（压缩） | 424,438 |
| instance_physics.json | 6,253 |
| trace/gaussian_iggt_phys_feat.pt（非必需） | 218,142,004 |
| gau_phys_feat_fp16.pt（非必需） | 79,123,937 |

N 的内存公式可直接复核：labels+valid = 5N = 4.984 MiB；只含位置3、旋转4、二维尺度2、opacity1、RGB3 的 float32 数组 = 52N = 51.834 MiB；当前三轴 SplatCloud = 56N = 55.822 MiB；额外保留 rest SH = 180N = 179.427 MiB。完整 PLY 属性数组 = 308N，几乎再复制一个 307 MiB 文件；32 维 float32 物性特征 = 128N = 127.592 MiB，无须为读取现有 SI 参数常驻它。以上是选定数组表示的算术成本，不是浏览器总内存下限或峰值测量；还需考虑原始文件 ArrayBuffer、解压、复制、GPU 上传、排序、选择索引、网格等。

现有 [cloud reader](/home/liaowanjun/Projects/simulation/try_off1/claude/src/assets/splats/cloud.js:35) 强制 scale_2，直接加载会拒绝文件；它只保留 DC 颜色。现有 [cleanCloud/subsetCloud](/home/liaowanjun/Projects/simulation/try_off1/claude/src/assets/splats/clean.js:39) 会压紧属性并丢弃原始行号、labels 和其它字段；现场 opacity < 0.1 共 177,556 个，所以若不携带相同索引映射，实例关联即破坏。[loadCapture](/home/liaowanjun/Projects/simulation/try_off1/claude/src/assets/splats/capture.js:40) 还逐次 clean/orient/place；[placeCloud](/home/liaowanjun/Projects/simulation/try_off1/claude/src/assets/splats/place.js:91) 按每云范围缩放、居中、落地。对每个实例各调用一次会破坏原场景相对布局与比例。读取/转模拟过程中保留原始索引与共同场景变换是由数据对应关系导出的必要约束，具体接口交后续票决定。

## 可复现的只读统计

以下在本机 `python` + NumPy 运行；不需要 torch、不加载 PT pickle、不运行 GPU。原始数据路径以用户给定位置为准，JSON 内历史 GPU 路径只作来源文本。

```python
from pathlib import Path
import numpy as np, json
s = Path('/home/liaowanjun/Datas/instascene_preprocessed_data/3dovs/bench')
r = Path('/home/liaowanjun/tmp/mx_runs/bench_504x336')
p = s/'point_cloud.ply'
with p.open('rb') as f:
    header = []
    while True:
        line = f.readline().decode().strip()
        header.append(line)
        if line == 'end_header': break
    offset = f.tell()
n = int(next(x.split()[-1] for x in header if x.startswith('element vertex')))
names = [x.split()[-1] for x in header if x.startswith('property')]
assert all(x.startswith('property float ') for x in header if x.startswith('property'))
a = np.memmap(p, mode='r', offset=offset, dtype=[(x,'<f4') for x in names], shape=(n,))
z = np.load(r/'labels.npz', allow_pickle=False)
j = json.loads((r/'instance_physics.json').read_text())
print(header, [(k,z[k].shape,str(z[k].dtype)) for k in z.files])
print(np.unique(z['labels'], return_counts=True))
assert len(z['labels']) == n == len(z['valid'])
assert np.array_equal(z['valid'], z['labels'] > 0)
assert all(x['n_gau'] == np.count_nonzero(z['labels'] == x['instance_id']) for x in j['rows'])
print('nonfinite', sum(np.count_nonzero(~np.isfinite(a[k])) for k in names))
print('opacity<0.1', np.count_nonzero(a['opacity'] < np.log(.1/.9)))
print('bounds', [(k,float(a[k].min()),float(a[k].max())) for k in ['x','y','z']])
print('scales', [(k,np.quantile(np.exp(a[k]),[0,.5,1])) for k in ['scale_0','scale_1']])
print('normals nonzero', [(k,np.count_nonzero(a[k])) for k in ['nx','ny','nz']])
print('physics', [(x['instance_id'],x['rho_si'],x['E_si'],x['nu_si']) for x in j['rows']])
for f in [p,r/'labels.npz',r/'instance_physics.json',r/'trace/gaussian_iggt_phys_feat.pt',r/'gau_phys_feat_fp16.pt']:
    print(f, f.stat().st_size)
print('MiB by bytes/row', [(b,b*n/2**20) for b in [5,52,56,128,180,308]])
```

限制：未安装 torch，未加载追踪 checkpoint 内容；因此“该次导出确实来自当前脚本版本”的证明仍不完整。代码保证描述的是现场代码路径，样本统计描述的是当前文件，两者不可混同。没有外部网络资料或原训练仓库的结论依赖；所有判断来自以上本地第一方代码和给定数据。
