# Spec · 代理几何重构：点阵的知识只住在 `sim/discretize/lattice/`

Status: ready-for-agent

## 目标

今天的 `Lattice`（11 个公开字段）被 `simulator.js`、`grip.js`、`sim/constraints/`、`deformation/`、
`sim/debug/`、`ui/`、`main.js` 直接伸手读取。重构之后，模拟体的离散化只通过一个中立接口
`ProxyGeometry` 交出去，点阵的实现 `VoxelLattice` 连同它的全部知识住进 `sim/discretize/lattice/`。

**完成标准（机器可读）**：`test/unit/architecture.test.js` 里的 `DISCRETISATION_DEBT` 为空，常量与
引用它的两条测试一起删掉，`npm test` 全绿。债单有一条测试专门让已还清的条目变红，所以每一步做完
都必须把那一步还掉的条目从表里删掉，进度随时可以从表里读出来。

## 执行前必读

- [03 · 代理几何的类型边界](issues/03-proxy-geometry-type-boundary.md)的 Answer：接口条目与不变量的
  来历、点阵怎么满足每一条。**本 spec 的「接口」一节覆盖它有出入的地方**，以本 spec 为准。
- `docs/adr/`：0003（材料逆质量的零只表示惰性）、0005（体素点阵）、0006（这道缝买的是局部性）、
  0007（弹性由离散化交出，接触不由它交出）、0008（接触用球并集）。
- `CONTEXT.md`：用词。`Lattice` 在新代码里只指裸网格，中立产物叫 `ProxyGeometry`。

## 接口

### 条目

八条挂在每个物体的 `ProxyGeometry` 对象上，一条挂在模块上。typedef 放在 `sim/discretize/`
（驻留区之外，中立），点阵实现放在 `sim/discretize/lattice/`。

| # | 条目 | 调用方 | 点阵怎么给 |
|---|---|---|---|
| 1 | `dof` = `{restPositions, invMass, nodeCount}` | `Particles` | `buildLattice()` 原样 |
| 2 | `contactSurface()` = `{nodes, radii}` | `BodyContact` | `surfaceNodes()`；`radii` 全填 `h / 2` |
| 3 | `field(nodePositions, nodeOffset)` → `DeformationField` | `render/` | 今天的 `latticeField()` |
| 4 | `wireframe()` = `{kind: 'lines', positions, offsets, indices, groups}` | 线框视图 | 今天 `latticeView.js` 的 `buildGroupGeometry()`，见 I4 |
| 5 | `scale()` = `{label, value}` | `ui/panel.js`、`main.js` 日志 | `{label: '格', value: cells.length}` |
| 6 | `spacing` = `{min, max}` | `grip.js`（瞄准容差、抓取上限）、`broadphase.js`（桶容量 warning） | `{min: h, max: h}` |
| 7 | `cflLength` | `timestep.js` / `compliance.js` 的波速比 | `h` |
| 8 | `setDensity(previous, density)` | `simulator.setMaterial` | 今天的 `relumpMasses()` |
| 9 | 模块级 `elasticConstraints(device, particles, proxies, materials)` → `Constraint[]` | `simulator.js` → `Stepper` | 场景里所有 `VoxelLattice` 合成一个今天的 `ElasticCells` |

`simulator.js` 里的 `coarsestCell()` / `finestCell()` 改成对各物体的 `spacing.max` 取最大、对
`spacing.min` 取最小。`stats().perBody` 的 `gamma` 只取决于材料（`1 + mu / lambda`），直接由材料
算，不经过离散化。

### 不变量

- **I1** `dof.invMass[i] === 0` 只表示该槽位**没有材料**（惰性节点）。`nodeCount` 是占用的槽位数，
  接口不承诺每个槽位都有质量。「此刻不被解算」是 `Particles` 合成 `gpuInvMass` 之后才成立的
  读法，**不是**本接口的承诺（ADR-0003，覆盖 03 §三原文）。
- **I2** `contactSurface().radii` 必须**密封**：凡是在 `wireframe()` 里被一条线段直接连着的两个接触
  节点，它们的距离不超过两者半径之和。**这是球接触模型（ADR-0008）的准入条件**，不是代理几何的
  规律，写注释时照这个口径写。条目 2 的形状也由 ADR-0008 决定。
- **I3** `spacing.min` 是成品节点集**实测**的下界，不是生成器的保证，而且不承载正确性：它只喂
  `console.warn`，桶溢出由 `sort.wgsl` 确定性兜底。
- **I4** `wireframe().positions` **就是节点的静止位置**，逐个与 `dof.restPositions` 中的某个节点
  重合；`offsets` 是静止空间里的收缩方向（今天 `buildGroupGeometry` 的 inset 方向），收多少由
  画的人决定。`groups` 的含义对画的人不透明（点阵是色批）。一致性测试依赖它来检查 I2，所以
  它不是可有可无的调试产物，注释要写明。
- **I5** `field()` 的 `parameters` 不透明，契约只有 WGSL 的 `deformationAt(rest) -> Deformation`。
  `deformedNode` **不进**契约：它预设节点编号是稠密整数空间，而那正是要降级成实现内部的假定。
- **I6** 各物体拥有**不相交的节点区间**（`particles.offsetOf`）。

### 作者侧的细度：`resolution` → `elementSize`

`SoftBody` 的 `resolution`（「最长轴上几个格」）换成 `elementSize`：**世界空间里的目标单元尺度，
单位米**，默认 `0.01`。点阵直接拿它当 `h`：`dims = ceil(extent / elementSize) + 2 * padding`，
「最长轴」这个概念消失；以后的四面体后端拿它当目标边长。它是作者提出的**要求**，与条目 6 的
`spacing`（**实测**的节点间距）是两回事，不要合并，也不要用 `spacing` 命名它。

场景作者今天本来就是先想好几毫米，再倒推出份数的（`tank.js`、`football.js`、`splats.js` 的注释
都写着毫米）。换算时，想保持行为逐位不变就把值写成 `0.16 / 16` 这种形式，否则直接写注释里的
毫米数；两种都可以，但同一个场景内统一。

## 依赖表

`test/unit/architecture.test.js` 的 `ALLOWED` 最终变成：

- `'sim/discretize'`: `['deformation', 'assets', 'sim/state', 'sim/constraints', 'body']`
- `'sim/constraints'`: `['sim/state', 'body']`（删 `sim/discretize`）
- `'sim/debug'` 整行删除

理由见 ADR-0007 的 Consequences：离散化自己造弹性约束，要看见 XPBD 的顺服量与本构投影；接触改收
`contactSurface()` 之后，约束一侧不再需要看见离散化。文件顶上那段对每条规则的解释要一起改写。
**这一改动按 `CLAUDE.md` 要写一条 ADR，在改表的那一步里写。**

## 步骤

每一步是一次提交，提交后 `npm test` 全绿。顺序是先接口后搬家：外人先改走接口，搬家就只剩机械地
改 import。

### 每一步都要做的

- 删掉这一步还清的债单条目；「没有已还清的债」那条测试会逼你删干净。**债单只减不增**：新文件
  若要说点阵的词，就直接建在 `sim/discretize/lattice/` 里，不许往债单里加条目。
- **注释跟着代码走**。02 审计出的九条承重假定（稠密索引寻址、惰性节点、静止形状全等、接触桶
  容量依赖最小节点间距、点定位是一次除法……）都写在源码注释里。搬家时带着走，不许丢，也不许
  抄进任何文档（ADR-0004）。
- 新增或删除目录时，同一次提交里改 `ARCHITECTURE.md` §二的表（`docs.test.js` 双向核对）。

### 第 1 步 · 中立接口，原地满足

- 在 `sim/discretize/` 定义 `ProxyGeometry` typedef（条目 1–8 与六条不变量写成 JSDoc）。
- 新建 `sim/discretize/lattice/voxelLattice.js`：包住今天的 `Lattice`，实现条目 1、2、4、5、6、7、8。
  条目 4 的几何构造从 `sim/debug/latticeView.js` 搬过来，改成交节点静止位置（I4）；
  `latticeView.js` 改为消费 `wireframe()`。`relumpMasses()` 变成 `setDensity()`。
- `discretizeBody()` 返回 `ProxyGeometry`。
- 调用方改走接口：`simulator.js`（`particles` 构造、`coarsestCell`/`finestCell`、`worst`/`waveRate`、
  `stats`、`setMaterial`）、`grip.js`、`bodyContact.js`（半径改读 `contactSurface().radii`，
  `RADIUS_CELLS` 连同它的论证搬进 `voxelLattice.js`）、`broadphase.js`（读 `spacing.min`）、
  `compliance.js` 的 `waveRatio`（读 `cflLength`）、`timestep.js`、`ui/panel.js`、`main.js`。
  `ElasticCells` 这一步仍然接收 `VoxelLattice` 内部的裸 `Lattice`，第 3 步再动。
- `§二` 加 `sim/discretize/lattice/` 一行。
- 新建 `test/unit/proxyGeometry.test.js`：**一致性测试**，按实现参数化（今天只有 `VoxelLattice`
  一项，用两三个小形状造），逐条检查条目 1、2、4、5、6、7、8 的形状与 I1、I2、I3、I4、I6。I2 按
  上面的定义用 `wireframe()` 的线段检查；I3 用一趟暴力最近邻实测。第二个后端要接进来，先过这份
  测试。在 `ARCHITECTURE.md` §四（护栏表）加一行：「代理几何的接口不变量（含球接触的密封条件）｜
  `test/unit/proxyGeometry.test.js`」。

还掉的债：`simulator.js`、`grip.js`、`bodyContact.js`、`broadphase.js`、`timestep.js`、`ui/panel.js`、
`main.js`、`discretize.js` 中已经不再说点阵的那些（以测试为准；`compliance.js` 要到第 3 步才还清）。

### 第 2 步 · 纯搬家

`lattice.js`、`kuhn.js`、`voxelize.js`、`cloudVolume.js` 搬进 `sim/discretize/lattice/`，只改 import
路径与测试里的路径，不改逻辑。`mat3.js` 若不说点阵的词就留在原处。

还掉的债：前四条 `moves`。

### 第 3 步 · 条目 9：弹性约束由实现交出

- `elasticCells.js`、`wgsl/cells.wgsl`、`wgsl/project.wgsl` 搬进 `sim/discretize/lattice/`，外面包成
  模块级的 `elasticConstraints()`；`simulator.js` 改调它。
- `compliance.js` 的 `tetRestVolume` 搬进驻留区；`elementCompliance` 改成接收单元静止体积（一个数），
  留在 `sim/constraints/`——它是 XPBD 的公式，不是点阵的。
- `cells.wgsl` 里的 `xpbdCouple`（偏量与体积两条约束的 2×2 联立求解）是本构模型的数学，与点阵
  无关：拆成 `sim/constraints/wgsl/` 下的一个独立文件，驻留区拼接它。`body/material.js` 的注释
  改指这个新文件。
- 改 `ALLOWED`（见「依赖表」），写 ADR 记下依赖方向翻转的理由；改 §二 里 `sim/discretize/` 与
  `sim/constraints/` 两行的措辞（弹性约束现在住在离散化那边）。

还掉的债：`elasticCells.js`、`cells.wgsl`、`project.wgsl`、`compliance.js`。
兑现：`elastic.test.js`、`compliance.test.js`、`architecture.test.js`。

### 第 4 步 · 条目 3：采样器搬出形变通道

- `deformation/sample.js`、`sample.wgsl`、`corners.js` 搬进驻留区；`latticeField()` 从 `bind.js` 搬过来
  挂成 `field()`；`simulator.field()` 改调它。
- `bind.js` 只剩 `DeformationField` typedef、`COVARIANCE_WGSL`，以及那句契约（`shader` 必须声明
  `deformationAt(rest) -> Deformation`）。头部「只有一份实现，因为 `render/` 与调试视图唯一的
  交集在这里」那段论证删掉（11）：通道只持有契约，没有实现可以重复。改写 §二的 `deformation/` 那一行：它从此持有的是契约，
  不是实现。
- 一致性测试补上 I5：在一个已知的仿射形变下，`deformationAt` 在静止节点处给出正确的位置与梯度。

还掉的债：`sample.js`、`sample.wgsl`、`corners.js`、`bind.js`。
兑现：`sample.test.js`、`renderPaths.test.js`、`proxyGeometry.test.js`。

### 第 5 步 · 线框成为一条渲染路径

- `latticeView.js` 改写成 `render/` 下的一条路径，只认 `DeformationField` 与 `wireframe()`；
  `sim/debug/` 目录删除，`ALLOWED` 删掉那一行，§二删掉那一行。
- `architecture.test.js` 里 `render/` 那条词表测试的注释，删掉为 `sim/debug/` 写的豁免理由。
- 线框只是又一份被形变带动的几何：静止位置就是节点，图元是线段。`render/` 按**图元种类**
  （三角形、高斯、线段）派发画法，不知道几何从物体来还是从代理几何来；`main.js` 把
  `wireframe()` 当纯数据交进去，`render/` 不 import `sim/`。
- `renderPaths.test.js`：「每种声明的 kind 都有 `VIEWS` 项」改成「凡是会被交出来的几何的图元
  种类都有画法」（物体的 `RenderGeometry` 与 `wireframe()` 一起算）；删掉网格组与高斯组互不
  import 那条（`render/` 内部的事，跨模块的边由 `architecture.test.js` 兑现）；GPU sorter 那条不动。
  文件头改掉「两种表示法」的说法。
- `ARCHITECTURE.md` 不用再动：§三、§二 `render/` 行、§四那一行已由
  [11 · §三第一条承诺与线框渲染路径](issues/11-commitment-one-and-wireframe-path.md) 改好。

还掉的债：`sim/debug/latticeView.js`。


### 第 6 步 · 细度的单位

- 按「作者侧的细度」一节，把 `resolution` 换成 `elementSize`：`body/softBody.js`、`body/factory.js`、
  `voxelize.js` 的 `gridForBounds`、`cloudVolume.js`、全部场景（`tank`、`football`、`splats`、`mixed`）
  及相关测试。
- 场景注释改说毫米，不再说「份」「格」。`tank.js` 里「全场共用一个尺度，CFL 因此一致」的论证保留，
  改成用 `elementSize` 表述。
- `body/material.js` 的稳定性论证改成按单元尺度 / `cflLength` 说，不再说 cell。

还掉的债：`scene/tank.js`、`scene/splats.js`、`scene/football.js`、`body/material.js`。
兑现：债单、`timestep.test.js`、`voxelize.test.js`、`cloudVolume.test.js`、`simulatorTiming.test.js`。

### 第 7 步 · 下游措辞，清空债单

- `assets/shapes.js`、`assets/tessellate.js`、`assets/splats/clean.js`、`assets/splats/measure.js`、
  `deformation/covariance.js`：改写用点阵解释自己的注释，说成「代理几何」「单元尺度」。这些文件
  没有接口条目要它们改，只是说的话会不再成立。
- `scene/mixed.js` 头部：「one body from each render path」「contact … on the nodes」改说成
  「接触发生在代理几何上，与画出来的是什么无关」；它是演示场景，不再自称§三的验收。
- `broadphase.js` 的 hash grid、`timestep.js` 的 CFL 若还剩中性的 `cell`：在那个文件里改名
  （grid cell → bucket，cell crossing → element crossing），不要留在债单上。
- 抓取链改用 `CONTEXT.md` 的词（12）：`handle` / `handleTarget` / `handleVelocity` / `setHandle`
  → `grabTarget` 系列（`simulator.js`、`kinematicDrive.js`、`drive*.wgsl`）；typedef `Grip` →
  `GrippedPart`（`grip.js`）；`DEFAULT_GRAB_RADIUS` → 说握持物半径的名字；`kinematicDrive.js` 里
  「handle anchor」拆开说成锚点与抓取目标。不进债单，与本步一起改。
- 删掉 `DISCRETISATION_DEBT` 常量和引用它的两处；「没有已还清的债」那条测试随之删除，词表测试
  改成不带豁免表。

兑现：`npm test` 全绿、债单不复存在。

## 不做

- **不实现第二个离散化后端**（四面体或点云）。这份 spec 的一致性测试就是它的准入条件，后端本身
  是下游的另一份工作。
- **不换接触模型**。仍然是边界节点上的球（ADR-0008）；表面三角形接触是另一份工作。
- **不改 `ARCHITECTURE.md` §三的论证**，第 5 步照 11 的结论做的除外。§三第二条（批次规则）
  归 10，原§四各根已由 13 转成 ADR-0009/0010/0011。
- **不把标量 `invMass` 换成 3×3**，**不做静态规定（锚定）的机制**：各有自己的去处。
