# 03 · 代理几何的类型边界

Status: resolved
Type: grilling
Blocked by: 02

## Question

**把 `Lattice` 重塑成什么形状，使「它是个点阵」只有一个地方知道。**

`Lattice` 今天是个**浅模块**：11 个公开字段摊开给五个客户，每个客户为了用其中两三个必须认识
全部。02 的审计撞出的每一处，都是同一件事的实例——「它是个点阵」泄漏到了每一个客户身上。

> **2026-09-20 重写。** 本票原问「哪些字段属于代理几何、哪些属于体素点阵」。那个问法预设答案
> 是对一个共享对象做**字段划分**，而字段划分继承了浅模块的形状：无论怎么划，结果仍是一个被
> 五个客户共享的对象，只是中间多了一道虚线。真正的病是高耦合低内聚，重构正是为此。
> 旧问法连同两条自相矛盾的注记一并删除。

## 词汇

本票用 `codebase-design` 的词：**模块 / 接口 / 深度 / 缝 / 适配器 / 杠杆 / locality**。
两条对本票直接生效的定义：

- **接口 = 调用者为了正确使用这个模块必须知道的一切**：签名，**以及不变量、顺序约束、错误
  模式、性能特征**。
- **深度 = 接口上的杠杆**：调用者每学一个单位的接口，能调动多少行为。

第一条修掉了一个早先的误判。「桶容量的硬界依赖『节点永不比 `h` 更近』」曾被当成「接口卫生
到不了的诡异耦合」。不是。那条不变量**就是接口的一部分**，和字段平级；`broadphase.js` 依赖它
完全正当，不正当的是它从未出现在任何签名、文档或测试里，于是没人知道换实现时要重新谈判它。
`restScale = 1/h` 依赖「所有单元静止形状全等」同理。**三处隐形耦合其实是同一件普通的事：
接口写漏了。**

## 这道缝买的是 locality，不是 swappability

「一个适配器 = 假想的缝；两个适配器 = 真缝。」四面体网格是**反事实**，不是第二个适配器，
而且「真的实现第二个离散化后端」在本图 Out of scope。照这条规矩，现在造缝是在造一道只有
一个居民的缝。

但仓库里已有两道同样只有一个适配器、且**已经回本**的缝：`simulator.js:58-62` 递给
`Particles` 的三个数组，`bind.js` 交出的 `shader` + `parameters`。两处都有注释说明是自觉
这么做的，两处都在反事实下一行没动——它们买到的不是可替换性，是 **locality**。

所以立票的判据不是「将来会不会换四面体」，而是「4.2 那句代价声明能不能变成真话、护栏能不能
机器检查它」。**按 locality 立，缝值得造；按『将来要换后端』立，是自欺。** 这条要写进 ADR。

## 工作框架：接到已经存在的那道真缝上

`sim/solver/` 看得见 `sim/state/`，**看不见 `sim/constraints/`**；步进器派发约束但叫不出它们
的名字。这道缝今天有**三个适配器**（弹性、接触、运动学驱动）——按两适配器规则，它是本仓库
唯一一道已被证实的真缝。

离散化的变化不该另开一道缝，该接到这一道上：

> **离散化不交「数据」给一个中立的弹性约束，它直接交出「它自己的弹性约束」。**

`ElasticCells` 今天的病用这套词说得很准：**名字是中立概念，形状是点阵**。它读
`cells`/`colorRanges`/`h`/`cellDims`/`nodeDims`，把 6 个 Kuhn 矩阵编译进 shader。把它搬进点阵
实现里改叫 `LatticeElasticity`，这五个字段**从接口上整个消失**——不是被划到线的某一侧，是
不再有人看得见。

**跨物体合并 dispatch 不受损**：按**种类**建约束而不按物体。场景里所有点阵物体合成一个
`LatticeElasticity`，今天的同色合批原样保留（它依赖的「物体拥有不相交节点区间」本就中立）；
混合场景出现两个弹性约束，而步进器本来就叫不出名字，多一个零成本。

## 模块形状（草案）

| 客户 | 接口条目 | 藏进去的 |
|---|---|---|
| `Particles` | 自由度载荷（三个数组） | 已是深缝，不动 |
| `sim/solver/` | **它的约束们**（走已有真缝） | 单元表、批次规则、每单元静止形状、投影核 |
| `render/` | `DeformationField` | 采样器、点定位、形函数。已是深缝，不动 |
| `BodyContact` | 表面节点 + 半径，**外加最小间距保证** | 边界节点怎么算出来的 |
| `sim/debug/` | 它自己的可见化 | `latticeView.js` 整份 |
| `ui/` | 规模描述 `{label, value}` | 「格」这个词——词汇泄漏随之消失，因为词成了模块自己的 |

六条，每条背后都是大量行为。对比今天：11 个公开字段，每个客户为了用其中三个得认识全部 11 个。

**删除测试**：删掉这个模块，复杂度不消失，它原样散回 `ElasticCells`、`BodyContact`、
`latticeView`、`ui/`、`simulator`——也就是今天的样子。所以它挣得到自己的位置。

顺手能藏进去的：`relumpMasses`（密度变化）、`coarsestCell()/finestCell()`（瞄准容差）、`stats()`。

## 要决定的

1. **「离散化交出自己的约束」走不走这么远。** 这是整版里最激进的一步：它让 `ElasticCells`
   作为一个中立模块**不再存在**。替代方案是保留中立的 `ElasticCells`，由离散化供给单元与
   批次数据——但那样 `cells`/`colorRanges` 仍在接口上，泄漏只是变薄没有消失。
2. **接口承诺哪些不变量。** 这是本票真正难的部分，也是唯一一处**接口设计会倒过来改变算法
   形式**的地方。具体是最小间距保证：点阵给得出（`= h`）；四面体网格生成器给不给得出，取决于
   它保不保证最小二面角。承诺它，则四面体实现要么满足要么进不来；不承诺，则 `broadphase.js`
   的确定性容量界**现在就得**改成概率界。与 10 同源。
3. **`BodyContact` 为什么不能照 1. 办**：接触跨物体，不能每个代理几何自带一份。所以它收
   「数据 + 保证」而不是「一个约束」。这个不对称要在 ADR 里讲清楚，否则下一个人会想统一它。
4. **点阵采样器搬不搬出 `deformation/`。** `sample.js` + `sample.wgsl` + `corners.js` 三者皆
   点阵专属，却住在自称中立的通道目录里——`CUBE_CORNERS` 不是放错的常量，是「通道与一个实现
   合住」的症状。搬则连带 `ALLOWED` 表、`architecture.test.js` 与一条 ADR。搬完 `deformation/`
   只剩结构承诺的原文两件事，那句承诺**第一次可被机器检查**（该目录从此不该出现任何离散化
   词汇），这正是 06 要扩的射程。
5. **命名**：中立模块与点阵实现各叫什么；`Lattice` 这个名字退回去只指那个规则网格本身。

## 02 已经带回来的（2026-09-20）

- **纯中立字段只有五个**：`restPositions`、`invMass`、`nodeCount`、`mass`、`volume`。前三个
  正是 `simulator.js:58-62` 递给 `Particles` 的三元组。
- **点阵专属六个**：`origin`、`h`、`cellDims`、`nodeDims`、`cells`、`colorRanges`。
- **`sim/constraints/` 按文件分，不是整个目录选一边**：`kinematicDrive.js` 与三个 Jacobi 内核
  纯中立；`elasticCells.js` + `cells.wgsl` + `project.wgsl` + `compliance.js` 是点阵后果；
  `bodyContact.js` + `broadphase.js` 是「中立骨架 + 点阵专属常量与证明」。
- **`nodeCount` 的双义坐实**：`Lattice.nodeCount` 含惰性节点，`Particles.nodeCount` 是各物体
  之和；四面体下两义合一。倾向：新接口只留一个＝占用的自由度槽位数，「稠密含惰性」降级为实现
  内部的一句话，惰性节点归 05 挂到「稠密寻址」这条后果下。
- **`render/` 九个文件一行不动**（已核实）：`shader` + `parameters` 的不透明交接真的挡住了它。
- **中立成员的候选**：`sample.wgsl:206-208` 的 `deformedNode(node)`——任何离散化都有节点，
  `sim/debug/` 需要它，而 `bind.js` 今天明说它**不属于** field 的承诺。

清单细节见 [02 · 四面体反事实审计](02-tetrahedral-counterfactual.md)。

## 可以当场落账、不依赖以上任何决定

`compliance.js` 的自我归属是错的。它开头自称「换求解器就换掉这个文件」，但 `tetRestVolume`
（`1/6 * h³`）与 `waveRatio`（`/h`）是**离散化**专属而非求解器专属，该文件横跨 4.2 与 4.3。
交给 05 挂进修正后的后果表。

## 交付

使用者决定要**清单 + 类型草案**，不要只有清单：

- 草案写出中立模块的接口条目（含**不变量条款**）、点阵实现如何满足每一条、`bind.js` 采样器的
  中立签名。落在本票的 `## Answer` 与下游 spec（09）里，**不落 `src/`**。
- 线定下来后 `docs/adr/` 要有一条 ADR，必须记下「这道缝买的是 locality 不是 swappability」
  这条立票理由（ADR 目录由 07 建好）。

## Comments

## Answer

**把 `Lattice` 拆成一个中立的 `ProxyGeometry` 与一个住在 `sim/discretize/lattice/` 的
`VoxelLattice` 实现。今天 11 个公开字段 + 5 处外人伸手，换成 9 条接口条目。**

### 一、定下来的六条

| # | 问题 | 结论 |
|---|---|---|
| 1 | 中立的 `ElasticCells` 还存不存在 | **不存在**。点阵实现自己造出弹性约束交出来，`cells`/`colorRanges`/`h`/`cellDims`/`nodeDims` 从接口上整个消失。交出一个还是几个、怎么分组，是实现内部的事，不是接口条目 |
| 2 | 接口承诺哪些不变量 | 交出**每节点的接触半径本身**（密封性论证归实现），外加**实测的**节点间距。`RADIUS_CELLS = 0.5` 这个式子从 `bodyContact.js` 消失 |
| 3 | `BodyContact` 为什么不能照 1 办 | 见 §四 |
| 4 | 点阵采样器搬不搬出 `deformation/` | **搬**。`sample.js` + `sample.wgsl` + `corners.js` 进 `sim/discretize/lattice/` |
| 5 | 命名 | `ProxyGeometry`（中立产物）／`VoxelLattice`（实现）／`Lattice` 退回去只指裸网格，与 `sample.js` 的 `LatticeSpace` typedef 合并 |
| 6 | 调试视图 | **它是一条渲染路径**。接口加一条 `wireframe()`，画它的代码进 `render/`，`sim/debug/` 目录消失 |

### 二、接口条目（中立）

八条挂在对象上，一条在模块上。

| # | 条目 | 客户 | 藏进去的 |
|---|---|---|---|
| 1 | `dof` = `{restPositions, invMass, nodeCount}` | `Particles` | 节点怎么摆出来的、质量怎么集总 |
| 2 | `contactSurface()` = `{nodes, radii}` | `BodyContact` | 边界节点怎么算出来的、密封半径怎么来的 |
| 3 | `field(nodePositions, nodeOffset)` → `DeformationField` | `render/` | 采样器、点定位、形函数 |
| 4 | `wireframe()` = `{positions, offsets, indices, groups}` | `render/` | 单元怎么转成线段、组是什么意思 |
| 5 | `scale()` = `{label, value}` | `ui/` | 「格」这个词 |
| 6 | `spacing` = `{min, max}` | `sim/grip.js`（瞄准容差）、`BodyContact`（容量 warning） | 节点排布 |
| 7 | `cflLength` | `sim/solver/timestep.js` 经 `compliance.js` | 「最小单元尺度」在这种离散化里是什么 |
| 8 | `setDensity(previous, density)` | `simulator.setMaterial` | 质量集总规则（今天的 `relumpMasses`） |
| 9 | **模块级** `elasticConstraints(device, particles, proxies, materials)` → `Constraint[]` | `simulator.js` → `Stepper` | 单元表、批次规则、每单元静止形状、投影核、**以及按种类分组这件事本身** |

**6 与 7 必须是两条，不能合并。** 它们在点阵上都读作 `h`，纯属均匀网格的巧合：6 问的是
「节点排得多密」（接触与瞄准要的），7 问的是「最小的单元有多薄」（稳定性要的）。四面体网格
上两者可以差一个数量级 —— 最小节点间距是边长的下界，而 CFL 要的是最小高，两者无序关系。
**把它们合成一个数，就是把点阵的巧合当成了定律**，正是本图要拆的那种折叠。

### 三、不变量条款

接口 = 调用者为了正确使用必须知道的一切。这六条和字段平级，`ARCHITECTURE.md` 今天一条都
没写下来 —— 02 找到的「三处隐形耦合」就是它们漏写的后果。

- **I1** `invMass[i] === 0` 表示该槽位**此刻不被解算**，可能是惰性、也可能是被规定（04 的族）。
  `nodeCount` = **占用的自由度槽位数**，接口**不承诺**每个槽位都有质量。「稠密、含惰性节点」
  降级为实现内部的一句话。
- **I2（唯一一条倒过来要求实现的）** `contactSurface().radii` 必须**密封**：相邻边界球两两
  相接，另一个物体的节点不能从缝里穿过。点阵拿 `h/2` 满足它（`bodyContact.js:57-64` 的原
  论证）；四面体实现必须自己找出一个满足它的半径，找不到就进不来。
- **I3** `spacing.min` 是**实测下界**（成品节点集的可测属性，一趟 hash grid 就能测），**不是
  生成器保证**，而且**不承载正确性** —— `worstCaseBucketOccupancy` 只喂 `bodyContact.js:113`
  那条 `console.warn`，桶溢出由 `sort.wgsl:27-31` 确定性兜住（保留最低 32 个）。
- **I4** `wireframe().positions` 在**静止空间**，所以画的人喂 `deformationAt` 就够了；`groups`
  的含义对画的人不透明（点阵是色批，别人可以是别的，也可以只有一组）。
- **I5** `field()` 的 `parameters` 不透明；契约只有 `deformationAt(rest) -> {position, gradient}`。
  **`deformedNode` 不在契约里**（见 §五）。
- **I6** 物体拥有**不相交的节点区间**（`particles.offsetOf`）。这条是**中立**的，而它是跨物体
  合批唯一需要的前提 —— 见 §六第 1 条。

### 四、点阵实现如何满足每一条

| 条目 | `VoxelLattice` 怎么给 |
|---|---|
| 1 `dof` | `buildLattice()` 原样 |
| 2 `contactSurface()` | `surfaceNodes()` 原样；`radii` 全部填 `h * 0.5` |
| 3 `field()` | 今天的 `latticeField()`，从 `deformation/bind.js` 搬过来 |
| 4 `wireframe()` | 今天的 `buildGroupGeometry()`，把 `nodeData.w`（节点编号）换成静止位置 |
| 5 `scale()` | `{label: '格', value: cells.length}` |
| 6 `spacing` | `{min: h, max: h}` |
| 7 `cflLength` | `h` |
| 8 `setDensity()` | 今天的 `relumpMasses()` |
| 9 `elasticConstraints()` | 场景里所有 `VoxelLattice` 合成一个 `LatticeElasticity`（今天的 `ElasticCells`） |

**`h` 不能有任何一条通路活着离开这个模块。** 所以 `compliance.js` 里读 `h` 的两处
（`tetRestVolume = 1/6 * h³`、`waveRatio` 的 `/h`）必须跟着进来：前者是每单元静止体积，弹性
约束现在由实现自己造，就地算；后者改成读条目 7。**这只是「它不能留在外面」，`compliance.js`
挂在§四哪个根下面仍归 05。**

### 五、`BodyContact` 为什么不能照第 1 条办（票里的第 3 问）

**判据只有一个：约束是否跨物体耦合。**

接触跨物体：粗筛是一张世界空间均匀网格（4.3），窄相必须同时看见两个物体的边界节点。若每个
代理几何自带一份接触约束，混合场景里就有两张互相看不见对方节点的粗筛网格，**跨种类的接触
当场消失**。

弹性没有这个问题：弹性约束**从不**跨物体耦合。同色合批只是把互不相干的单元塞进同一次
dispatch，靠的是 I6（不相交节点区间），那是**共址**不是**耦合**。

所以不对称不是妥协，是判据的直接后果。**这一句必须进 ADR，否则下一个人会想统一它。**

### 六、这张票撞出来的三件、要交给别人的

1. **「一次 dispatch 覆盖所有物体的同色单元」的免费证明是 4.2 的后果，性质本身是中立的。**
   跨物体合并只需要 I6（中立）＋ 每个批次内部无冲突（各实现自己的事）。四面体实现照样能把
   自己的第 i 批和别人的第 j 批拼进一次 dispatch，只是不再有奇偶那个免费证明。**归属对了、
   独立性写宽了**，与 10 第 3 问（接触的双重归属）同类 → **10**。
2. **§三第一条承诺要改写。** 采样器搬走之后，「`render/` 只看得见 `deformation/`，`sim/debug/`
   只看得见 `sim/discretize/` 与 `deformation/`，唯一交集就是 `bind.js`」这段论证不再成立
   （`sim/debug/` 都没了）。保证从**分层强制**降级为**词表检查**。另外 `render/` 多了一条
   既不是网格也不是 3DGS 的路径，`renderPaths.test.js` 的「表示法」口径要重划 → **新票 11**。
3. **`deformedNode(u32) -> vec3f` 不升级为中立承诺**，理由不是嫌麻烦：这个签名**预设节点编号
   是一段稠密整数空间**，而「稠密索引寻址」正是 02 点名的承重假定之一，本图要把它降级成实现
   内部的事。写进契约等于给它盖章。核过 `sample.wgsl:36-47`：`deformationAt(nodeRest)` 在角点
   上三线性权重塌成 1，误差 ulp 量级，**线框视图用它就够，一条契约条目都不用加**。
   代价是线框从此和渲染走同一条点定位，**点定位的 bug 在它上面同样看不见** —— 对冲是§三
   已承诺的「CPU 参考解由单元测试对齐」，采样器有自己的看门狗，不必让调试视图兼任。

### 七、`deformation/` 搬空之后

目录**必须留下**：`render/` 只看得见它，分层没有第二个地方能放那个 typedef。它从此持有的是
**契约**而不是实现，§二那一行要跟着改写。

`bind.js` 剩下：`DeformationField` typedef、`COVARIANCE_WGSL`、以及那句契约（`shader` 必须
声明 `deformationAt(rest) -> Deformation`）。**「采样器的中立签名」这个交付物的答案是：没有
中立的工厂函数了。** `latticeField()` 是实现的，跟着搬走；中立的是 typedef 加那句 WGSL 契约。

### 八、目录与依赖表

`sim/discretize/lattice/` 收全部点阵专属：`lattice.js`、`kuhn.js`、`voxelize.js`、
`cloudVolume.js`、采样器三件、弹性约束三件（`elasticCells.js` + `cells.wgsl` + `project.wgsl`）、
线框几何的构造。`sim/discretize/` 只留 `discretize.js`（那张分派表）、中立 typedef、和条目 9。

- **`ALLOWED` 新增**：`sim/discretize` → `sim/state`、`body`（弹性约束要 `Particles` 与材质）。
  按 `CLAUDE.md`，改依赖表要留 ADR。
- **`ALLOWED` 删除**：`sim/debug` 整行。
- **`corners.js` 不用翻方向**：搬完它的五个 importer 全在 `sim/` 内，边只减不增。
- **§二的表**：删 `sim/debug/` 行、加 `sim/discretize/lattice/` 行、改写 `deformation/` 行。
  `docs.test.js` 双向核对，必须同一次改完。
- **`sim/discretize/lattice/` 从此是离散化词表唯一的豁免区** ——「它是个点阵只有一个地方知道」
  第一次成为一句可机器检查的话。这是 06 的射程。

### 九、ADR 要记的（目录由 07 建好，本票不落盘）

- **A. 这道缝买的是 locality，不是 swappability。** 四面体是反事实不是第二个适配器；立票判据
  是「4.2 那句代价声明能不能变成真话、护栏能不能机器检查它」。**最好的例证在这张票里撞出来
  了**：线框视图当初完全可以是渲染路径 —— 词表 `/\bdeform[A-Z]/` 抓不到 `deformationAt` 也
  抓不到 `deformedNode`（后面跟小写），**挡住它的从来不是分层规则，是「直接读 `lattice.cells`
  是免费的」**。按 swappability 立缝会得出「现在别造」，按 locality 立缝才解释得了这一处。
- **B. `BodyContact` 的不对称**：判据是「约束是否跨物体耦合」（§五）。
- **C. `sim/discretize` 依赖表新增 `sim/state`、`body`** 的理由。
- **D. `corners.js` 搬进 `sim/discretize/lattice/`**：它不是放错的常量，是「通道与一个实现
  合住」的症状。

### 十、交付去向

本票只出接口草案，**不落 `src/`**。执行顺序、每一步由哪个测试兑现、能不能切成多次提交 →
**09**。词表覆盖面与红转绿 → **06**。`compliance.js` 挂哪个根、4.2 的代价声明怎么改 → **05**。
