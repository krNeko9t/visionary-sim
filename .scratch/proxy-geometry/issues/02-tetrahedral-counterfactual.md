# 02 · 四面体反事实审计

Status: resolved
Type: task

## Question

拿**无结构四面体网格**当试金石，逐处撞一遍仓库，产出耦合清单：每一处读了点阵专属字段、或者
假定了空间规则性的位置，在无结构网格下**还成不成立**，成立需要什么。

选四面体而不是点云，是因为它保留「单元」与「per-cell 本构」，只拿掉「规则」——这样撞出来的
每一条都能归到 4.2（体素点阵）头上，而不会和 4.3（XPBD + 稳定 Neo-Hookean）混在一起。

### 扫描范围

`src/` 全部，不止提到 `lattice` 的那 17 个文件。要抓的不只是 import——`ARCHITECTURE.md` 自己
说过「一个模块可以不 import 就知道某件事」，所以真正要找的是这些形状：

- 读了 `h` / `cellDims` / `nodeDims` / `origin` / `colorRanges` / `cells` 之类**点阵专属字段**
  的地方（包括从别人递过来的对象上读）；
- 假定了**规则性**的地方：奇偶 8 色分批（`cellColor`）、稠密索引寻址（`nodeIndex`，八个角点
  靠算术推出、不需要连通性缓冲）、三线性内嵌、半格接触球、`h` 的倍数当长度单位；
- 假定了**惰性节点存在**的地方（`pick.js:36`、`grip.js:108`，以及任何靠 `invMass === 0` 跳过
  的地方）；
- WGSL 也算：`cells.wgsl`、`project.wgsl`、`sample.wgsl`、`collide.wgsl`、`contacts.wgsl` 等。

### 每一条要回答四件事

1. **在哪**（文件:行）；
2. **假定了什么**；
3. **四面体下成不成立**——三档：照搬即可 / 要换实现但概念不变（例：三线性 → 重心坐标）/ 概念
   本身失效（例：奇偶 8 色分批，无结构网格要运行时图着色）；
4. **这条假定今天有没有被文档声明过**——挂在 `ARCHITECTURE.md` 4.2 的后果表里的算已声明，没挂
   的是**漏网**，那一栏才是这张票真正的产出。

### 已知的种子（不是结论，是起点，要核实也要补全）

- `ARCHITECTURE.md` 4.2 写「换掉：重写 `sim/discretize/`，`body/` 及以上不动」，但依赖表
  （`architecture.test.js` 的 `ALLOWED`）允许 `sim/constraints` → `sim/discretize`，而
  `elasticCells`（按格子）、`compliance`（读 `h`）、`bodyContact`（半格球）都会跟着重写。
  **代价声明少了一整个目录**，这是本票要坐实的第一条。
- `discretizeBody()` 直接返回 `Lattice`；`simulator.js` 里 `lattice` 出现 31 次；
  `deformation/bind.js` 的 `latticeField` 自称是「今天唯一存在的采样器」。**抽象层从未被命名**。
- 护栏 `DISCRETISATION` 词表只扫 `render/`；`ui/panel.js` 有「显示点阵」开关、`main.js`
  import `createLatticeView` 并把 `latticeViews` 挂 `window`，都在任何词表射程之外。
- `sim/grip.js` 是**反向**的例子：它整份文件都在防着点阵分辨率爬回来。审计要说清它防住了没有。

## 交付

清单是**一次性**的（使用者决定）：写在本票的 `## Answer` 里，不进 `src/`、不进 `docs/`。它的
价值全在被下游三张票蒸馏成：4.2 修正后的代价声明、护栏词表、重构 spec。

## Comments

## Answer

反事实：把每个物体的代理几何换成**无结构四面体网格**（顶点 + 四元素连通性缓冲 + per-element
静止形状矩阵），保留 XPBD 子步与稳定 Neo-Hookean，只拿掉「规则」。逐处撞完 `src/` 全部 69 个
文件（不只是提到 `lattice` 的那 17 个）。

三档判定：

- **A 照搬即可**——代码一行不动，语义仍然正确。
- **B 换实现、概念不变**——那件事四面体也要做，但算法/数据结构换掉。
- **C 概念本身失效**——这件事在无结构网格下不存在，或者它的证明消失了。

声明栏：**已声明** = 挂在 `ARCHITECTURE.md` §四某个根的后果表里（注明哪一条）；**漏网** =
只在源码注释里说过、或者根本没说过。**漏网那一栏是本票的产出。**

---

### 一、`sim/discretize/` 内部：4.2 已经认账的部分

| 在哪 | 假定了什么 | 四面体下 | 声明 |
|---|---|---|---|
| `lattice.js` 整份 | 代理几何 = 稠密节点网格 + 占据格子表 | **C** | 4.2 换掉栏 |
| `kuhn.js` 整份 | 每格切 6 个全等四面体 | **C** | 4.2 标题 |
| `voxelize.js`、`cloudVolume.js` | 离散化的输入是占据栅格；网格靠三轴射线奇偶投票、点云靠印椭球+封口+泛洪造出实心 | **C** | 4.2 第 4 条（扫描必须被发明出一个内部） |
| `voxelize.js:34-52` `gridForBounds` | `h = 最长轴 / resolution`；两格 padding，理由是「三线性内嵌需要每个渲染点周围一整格支撑」 | **C** | **漏网**（padding 规则与 `resolution` 的单位都不在后果表里） |
| `discretize.js:54-61` `relumpMasses` | 密度变化时 `invMass` 整体乘常数比 | **A**（任何 lumped mass 都成立） | 4.2 换掉栏 |

**这一栏没有惊喜，4.2 的「换掉」栏对这个目录是准确的。** 下面九栏才是问题。

---

### 二、`sim/constraints/`：整个目录跟着走——本票要坐实的第一条

`elasticCells.js` 的类注释写着「This is where everything about lattices now stops」。
**不成立。** 停不在那里，而且这个目录里四个 JS 文件加四个 WGSL 文件都要动。

| 在哪 | 假定了什么 | 四面体下 | 声明 |
|---|---|---|---|
| `elasticCells.js:116-134` | 单元表按 `COLOR_COUNT = 8` 奇偶分色；跨物体同色可并一个 dispatch | **C**——要跑运行时图着色，色数不定（一般 10-30），批次表变成构建产物而不是 8 个常量范围 | **漏网**（4.3 说了「奇偶前提对接触作废」，没说奇偶前提**本身**是 4.2 的后果，也没说 `elasticCells.js` 会跟着重写） |
| `elasticCells.js:47-56` + `wgsl/cells.wgsl:17-30` `struct CellParams` | per-body 常量里有 `cellDims: vec3u`、`nodeDims: vec3u`、`h: f32` | **C**——三者全部消失，换成 elementCount + 连通性缓冲基址 | **漏网** |
| `elasticCells.js:82-101` `kuhnConstants()` | 把 6 个 tet 的角点编号与 6 个静止形状逆矩阵**编译进 shader**（`var<private> array<..., 6>`） | **C**——静止形状逆矩阵变成 per-element storage buffer，是全场最大的缓冲；shader 从「零静止数据」变成「每 tet 一个 mat3x3f」 | **漏网**（`kuhn.js:120-123` 自己说过这是「normally the largest buffer in a FEM solver」，`ARCHITECTURE.md` 没有这一条） |
| `wgsl/cells.wgsl:38-44` `cellCoords()` | 线性索引可以除模还原成 3D 坐标 | **C**——无结构网格没有 3D 坐标 | **漏网**（`lattice.js:59-65` 声明了 JS/WGSL 两份的**重复**并用测试对住，但「点阵性」不在后果表里） |
| `wgsl/cells.wgsl:48-52` `cornerNode()` | **八个角点靠算术推出，不需要连通性缓冲**：`nodeOffset + n.x + nodeDims.x*(n.y + nodeDims.y*n.z)` | **C**——必须读连通性缓冲。这是整份审计里最承重的一条假定 | **漏网**——只写在 `lattice.js:6-9` 的 typedef 注释里。它同时是「惰性节点为什么必须存在」的唯一原因 |
| `wgsl/project.wgsl:149-173` | 一个线程 = 一格；八个节点进寄存器、六个 tet 在寄存器里跑真 Gauss-Seidel、写回一次 | **C** 线程映射（变成一线程一 tet，或一线程一批次成员）；**B** 「批次内 Gauss-Seidel」这件事保留 | **漏网** |
| `wgsl/project.wgsl:183` `restScale = 1.0 / cp.h` | 所有单元静止形状全等，只差一个标量 | **C** | **漏网**（同上，是 15 的同一条根） |
| `compliance.js:23-25` `tetRestVolume` | 静止体积 = `1/6 * h³`，是**公式**不是数据 | **C**——per-element 数据，于是 `elementCompliance()` 的返回值从 per-body 变成 per-element，`uploadParams()` 从「写 5 个 float」变成「重算一整个缓冲」，材料滑杆的「便宜」保证要重新论证 | **漏网** |
| `compliance.js:101-103` `waveRatio` | CFL 长度尺度 = 单个 `h` | **B**——变成 per-element 归约（最短高 / 最长边），每个物体一个标量仍然求得出来 | 4.3 第 1 条说了「按最坏材料与**格子**选 CFL」；但「一个物体只有一个 `h`」是 4.2 的后果，**这半句漏网** |
| `bodyContact.js:97` `radius = lattice.h * 0.5` | 半格球 | **C**——per-node 半径 ≈ 半个平均入射边长，而且 `RADIUS_CELLS` 注释里「相邻球沿轴相切、不留缝」这个推导（依赖节点恰好等距）**消失** | **已声明**，4.2 第 3 条。是全表唯一挂对了的一条 |
| `bodyContact.js:100` + `lattice.js:128-158` `surfaceNodes` | 边界节点 = 周围八格有占据有空；靠 `cellDims`/`nodeDims`/`cells` 算术枚举 | **B**——概念中立（「边界是物体的尽头」），实现变成「只被一个 element 引用的面」 | **漏网**（函数自己说了归属 `sim/discretize`，但「它是一次点阵形状的计算」不在后果表里） |
| `broadphase.js:70-73` `worstCaseBucketOccupancy` | **「点阵上的节点永不比 `h` 更近」，所以桶占用有硬上界** | **C**——无结构网格没有最小节点间距，硬界变成概率界或者要靠 mesher 的质量保证（最小二面角）才成立 | **漏网**。这一条决定 `BUCKET_SLOTS = 32` 的容量证明 |
| `wgsl/contacts.wgsl:55-59` `BUCKET_SLOTS = 32u` | 「32 覆盖两个物体在一次普通重叠里的 lattice corners」 | **C**——同上，容量论证跟着失效；溢出扫描从罕见变成常见的风险不再可界 | **漏网** |
| `wgsl/collide.wgsl:90-94` | 物体 = 边界节点上 `h/2` 球的并 | **C** 实现；**B** 概念（「接触在代理分辨率上发生」保留） | **已声明**，4.2 第 3 条 |
| `kinematicDrive.js` 整份 | 只收「一组节点 + 各自偏移」 | **A**——真的不用动，4.6 说对了 | 4.6 换掉栏 |
| `wgsl/{bin,sort,settle}.wgsl` | 只读 `surface[].node/.radius` 与世界网格 | **A** | — |

**结论**：把 4.2 换成四面体，`sim/constraints/` 里 **`elasticCells.js` + `compliance.js` + `cells.wgsl`
+ `project.wgsl` 基本重写**，`bodyContact.js` + `broadphase.js` + `contacts.wgsl` + `collide.wgsl`
**改常量与证明**，只有 `kinematicDrive.js` 与三个 Jacobi 内核原样留下。

---

### 三、`sim/simulator.js`：从未被命名的抽象层

| 在哪 | 假定了什么 | 四面体下 | 声明 |
|---|---|---|---|
| `simulator.js:47` | `discretizeBody()` 返回 `Lattice`，字段就叫 `lattice`（全文件 31 次） | **B**——类型要有个中立名字，`SimBody` 的 typedef 也要改 | **漏网** |
| `simulator.js:58-62` | 递给 `Particles` 的只有 `restPositions` / `invMass` / `nodeCount` | **A**——**全仓库唯一真正中立的三元组** | §三第二条（结构承诺），不在 4.2 后果表 |
| `simulator.js:124-131` `deformationOf()` | 硬编码调用 `latticeField({origin, h, cellDims, nodeDims})` | **B**——要写 `tetField()` 兄弟函数，而**选哪个采样器的决定落在这里**，这是 `bind.js` 那道缝的真正另一端 | **漏网**（`bind.js` 声明了缝存在，没人声明选择发生在 `simulator.js`） |
| `simulator.js:197-198` `stats()` | `tets: this.elastic.cellCount * 6` | **C**——Kuhn 专属算术长在统计报表里，不在 `discretize/` | **漏网** |
| `simulator.js:222-223` | 每个物体报 `h` 与 `cells.length` | **B** | **漏网** |
| `simulator.js:388,414-417` `coarsestCell()*1.2` | 瞄准容差 = 节点间距 | **B**——需要一个「代表性间距」标量 | **已声明**，4.6（明说 pick 的容差正当地是点阵属性） |
| `simulator.js:419-428` `finestCell()` | 同上，喂 grip 警告 | **B** | **已声明**，4.6 |

---

### 四、`deformation/`：channel 里藏着一个点阵常量

这一栏是最意外的。§三与 `bind.js` 都声明这条通道对表示法中立；`ALLOWED` 表也写着
`deformation` 不许依赖任何人。但——

| 在哪 | 假定了什么 | 四面体下 | 声明 |
|---|---|---|---|
| `corners.js:13-22` `CUBE_CORNERS` | **「模拟侧与渲染侧必须约定的那一个约定」是立方体八角点的编号** | **C**——四面体没有立方体角点。而且它被 `discretize/lattice.js`、`discretize/kuhn.js`、`discretize/cloudVolume.js`、`debug/latticeView.js`、`deformation/sample.js` 五处 import | **漏网**，而且**与 `bind.js` 自己的中立声明直接矛盾**：channel 里最中心的那个常量是 4.2 的产物 |
| `sample.js:47-60` `locate()` | 点定位 = 除法（`(p - origin)/h` 再 floor） | **C**——无结构网格的点定位需要空间索引，这是**算法升级不是替换** | **漏网**（4.4 说「`deformation/` 内部换算法，两侧不动」，没说这个代价） |
| `sample.js:69-103` `trilinearWeights` / `trilinearGradients` | 三线性形函数；梯度里 `1/h` | **B**——换成重心坐标（顺带变成**仿射**，4.4 那条「误差是二阶」的后果反而消失） | **已声明**，4.4 是自己的根 |
| `sample.js:27-31` `LatticeSpace` typedef | channel 的 CPU 参考解带着 `origin`/`h`/`cellDims` | **C** | **漏网** |
| `sample.wgsl:189-193` uniform 块 | `deformOrigin`/`deformH`/`deformCellDims`/`deformNodeDims` | **C**——但这是**设计好要换的**：整包名字是采样器私有的 | **已声明**，`bind.js:50-56` + §三 |
| `sample.wgsl:206-208` `deformedNode(node)` | 「几何已经坐在节点上、不需要插值」的调用者 | **A**——完全中立，任何离散化都有节点 | 半声明：`bind.js` 说它**不属于** field 的承诺 |
| `bind.js:73-84` `latticeField()` | 名字自报是「今天唯一的采样器」 | **B**——写兄弟函数，消费者不改 | **已声明**，`bind.js:50-56` |
| `covariance.js` / `covariance.wgsl` / `sample.wgsl:256-263` `deformedNormal` | 只吃 `mat3x3f` 梯度 | **A** | — |

**对 03 的「`bind.js` 那道缝是不是真的」**：缝**一半是真的**。`shader` + `parameters` 的不透明
交接确实经得起换（`render/` 两条路径原样通过，见第六栏）；但 `corners.js` 这个 channel 内常量
和 `sample.js` 的 `LatticeSpace` typedef 是缝的**漏点**——不需要第二个采样器就能证明，现在就能证。

---

### 五、惰性节点：`invMass === 0` 的四处读法

| 在哪 | 假定了什么 | 四面体下 | 声明 |
|---|---|---|---|
| `pick.js:33-38` | 逆质量为零 = 没有材料，不可抓 | **A** 代码；**C** 理由——四面体网格**没有惰性节点**（每个顶点都属于某个单元），这个分支只剩「被规定的节点」一种来源 | **漏网**（04 把「惰性节点」踢出词汇表之后它无处可挂） |
| `grip.js:108` | 同上 | **A** / **C** 同上 | **漏网** |
| `solver/wgsl/predict.wgsl:21-25` | 注释：「Inert nodes are **lattice corners** no cell touches, plus whatever a constraint has prescribed」 | **A** 代码；注释前半句变成假话 | **漏网** + **护栏漏洞**：`sim/solver/` 里出现了 `lattice` 这个词，`DISCRETISATION` 词表只扫 `render/`，`INTERACTION` 词表扫 `sim/solver` 但只查 grab/pointer/drag/grip |
| `solver/wgsl/finalize.wgsl:84-89` | 同上 | 同上 | 同上 |
| `state/particles.js:28` | `nodeCount` 的文档写「including inert ones」 | **A** 代码；语义收窄 | **漏网** |

**对 03 的「`nodeCount` 一个数字两种含义」**：坐实了。`Lattice.nodeCount` = 稠密网格总数（含惰性），
`Particles.nodeCount` = 各物体之和。四面体下两者含义合一，而 `invMass === 0` 的四处读法从
「离散化残渣 + 被规定」退回只有「被规定」——这正好是 05 要给惰性节点找的位置：它是
**「稠密索引寻址」这条后果的后果**，不是 4.2 的直接后果。

---

### 六、真正守住了的两处

| 在哪 | 为什么守住 |
|---|---|
| `sim/state/particles.js` + `state.wgsl` | 只知道位置、历史、逆质量、per-body damping/friction。`state.wgsl:7-10` 自称「Nothing about cells, colours or lattices appears in this file」——**核实为真**。**A**，一行不动 |
| `render/` 全部 5 个 JS + 4 个 WGSL | 只做两件事：把 `field.shader` 拼进自己的 shader、把 `field.parameters` 原样 `setParameter` 转发，然后调 `deformationAt(rest)`。**A**，一行不动。§五那条「`render/` 里不出现离散化词汇」的护栏是**这份审计里唯一发挥了作用的机器检查** |

`assets/` 也干净（`splats/measure.js:23` 只有一句散文提到 lattice 的轴向布局）。

---

### 七、护栏射程之外：4.2 说「`body/` 及以上不动」的四处反例

| 在哪 | 假定了什么 | 四面体下 | 声明 |
|---|---|---|---|
| `body/softBody.js:38-48` | `resolution = 16`，文档明写「Cells along the longest axis」 | **B**——无结构 mesher 要的是**目标边长（米）或 tet 预算**，不是「最长轴上几格」。单位换了，`body/` 就动了 | **漏网**——这条直接反驳 4.2 换掉栏的字面文本 |
| `body/factory.js:21,46,87` | 三个工厂把 `resolution` 原样穿过去 | **B**（jsdoc） | **漏网** |
| `scene/football.js:46,54,61,85,92`、`mixed.js:37,49`、`splats.js:84` | 八个调用点写着 `resolution: 12 / 8 / 20` | **B**——数值与单位一起换 | **漏网** |
| `main.js:42-49` | import `createLatticeView`、从 `sim.simBodies` 解出 `lattice`、建 `latticeViews`、`Object.assign(window, { latticeViews })` | **C** | **漏网**（`main.js` 在§二表里是「组装」，属于「`body/` 及以上」） |
| `main.js:127` | 启动日志打 `h=` 与 `cells=` | **B** | **漏网** |
| `ui/panel.js:156` | `toggle({ label: '显示点阵' })`，handler 名 `onLatticeToggle`（`panel.js:74` jsdoc 也是） | **C** | **漏网**。`ui/` **在所有词表射程之外**——`DISCRETISATION` 只扫 `render/` |
| `ui/panel.js:192` | 规模读数 `${body.cells} / ${stats.cells} 格` | **B** | **漏网** |
| `ui/panel.js:199-202` | grip 警告文案「范围重新随**点阵**分辨率变化」 | **B** | **漏网** |
| `ui/panel.js:120` | 注释「点阵越密越重」 | 散文，无害 | **漏网** |
| `sim/solver/timestep.js:11,35` | 文档单位写「cell crossings per second」 | **A** 代码（只收一个标量）；**B** 词汇 | **漏网**，无害 |

注意 `ui/` 这一组的机制：它**不 import 任何 `sim/discretize/` 的东西**，全部通过
`Simulator.stats()` 读到 `h`、`cells`、`tets`、`grip.worstCase`。这正是 `ARCHITECTURE.md` §五
说的那种「import 表看不见的知识边」，而现有的知识边检查没有一条覆盖它。

---

### 八、`sim/debug/latticeView.js`：整份文件

| 在哪 | 假定了什么 | 四面体下 | 声明 |
|---|---|---|---|
| 整份（`:12` import `COLOR_COUNT`/`cellCoords`/`cellNodeIndices`，`:42-51` 八色 tint，`:54-58` `CUBE_EDGES`，`:104-142` 按格子建线框，`:156` `inset = h*(1-shrink)/2`） | 代理几何可见化 = 每格一个缩小立方体线框，按奇偶色着色 | **C**——四面体版是另一个文件：线框四面体 + 图着色色数不定的 tint；`inset` 没有 `h` 可缩 | **漏网**——4.2 的后果表**完全没有 `sim/debug/` 这一行**，§二表只说它「使求解状态可见」 |
| `:60-85` `vertexWgsl` | 调 `deformedNode()`——采样器私有入口，不是 field 承诺 | **A**（见第四栏） | 半声明（`bind.js` 说了它不属于承诺，`latticeView.js:60-64` 也说了） |

---

## 蒸馏：给下游三张票

### 给 05（4.2 的代价声明与根结构）

1. **代价声明是错的，错两次。** 今天写「换掉：重写 `sim/discretize/`，`body/` 及以上不动」。
   真实代价：**`sim/discretize/` 重写**；**`sim/constraints/` 四个文件基本重写、四个文件改常量
   与证明**；**`sim/simulator.js` 改抽象层与采样器选择**；**`deformation/` 三个文件**（含
   `corners.js`——channel 内部）；**`sim/debug/latticeView.js` 整份**；**`body/`、`scene/`、
   `main.js`、`ui/` 各有改动**（`resolution` 的单位、显示点阵开关、规模读数）。
   守住的只有 **`sim/state/` 与 `render/`** 两处，以及 `assets/`。

2. **后果表少的条目**（每条都要么挂进 4.2、要么证明属于别的根）：
   - **稠密索引寻址，八个角点靠算术推出、不需要连通性缓冲**——最承重的一条，今天只写在
     `lattice.js` 的 typedef 注释里。**惰性节点是它的后果**，这就是 04 踢出词汇表之后它的位置。
   - **静止形状全等，所以没有 per-element 静止数据**（`restScale = 1/h`，`kuhnConstants()` 把
     6 个矩阵编译进 shader）。换掉就多出一个全场最大的缓冲。
   - **接触桶容量的硬界**（`worstCaseBucketOccupancy`、`BUCKET_SLOTS = 32`）**依赖「节点永不
     比 `h` 更近」**。同一条根也支撑 `grip.js:worstCaseHeldNodes` 的警告界。
   - **点定位是一次除法**（`sample.js:locate`）。换掉要空间索引。
   - **一个物体只有一个长度尺度 `h`**，所以 CFL、瞄准容差、接触半径、grip 下界都能写成一个标量。
   - **`resolution` 的单位是「最长轴上的格数」**，所以 `body/` 与 `scene/` 里有这个数。
   - **`CUBE_CORNERS` 是 channel 里的点阵常量**（或者：证明它该搬去 `sim/discretize/`）。
   - **`sim/debug/` 的可见化方式**（表里今天完全没有这一行）。
   - **`voxelize.js` 的两格 padding，理由是三线性内嵌要一整格支撑**——它跨 4.2 与 4.4 两个根。

3. **对「要不要拆根」的输入**：审计支持拆，而且给出了切线的位置。上位层能容纳的后果是
   「代理几何是一套空间离散的体积单元」——单元 + 批次 + per-element 本构 + 边界节点接触 +
   一个长度尺度，这些四面体全都有（判定 **B**）。下位层是「规则性」——奇偶 8 色、稠密寻址、
   全等静止形状、除法点定位、最小节点间距，这些判定全是 **C**。**B/C 的分界线就是拆根的位置**，
   不需要另外论证。三线性内嵌属于**上位**（四面体也要内嵌，换重心坐标就是 B），8 色分批属于
   **下位**。
   注意 4.4 今天是独立的根，但它的 `locate()` 靠 `h` 做除法——拆根时要决定 4.4 是独立根还是
   4.2 上位层的后果。

4. **`compliance.js` 的自我归属是错的。** 它的开头写「Everything specific to *this solver*
   lives here... Replacing the solver replaces this file」。实际上 `tetRestVolume`（`1/6 * h³`）
   与 `waveRatio`（`/h`）是**离散化**专属，不是求解器专属。这个文件横跨 4.2 与 4.3。

### 给 06（离散化护栏词表的覆盖范围）

词表 `DISCRETISATION`（`/\blattice/i, /\bvoxel/i, /\bcell/i, /\btetra/i, /\bdeform[A-Z]/`）
**只扫 `render/`**。射程外的实际漏出，按严重度：

1. **`ui/`** — `'显示点阵'`、`onLatticeToggle`、`${body.cells} 格`、警告文案里的「点阵」。
   `ui/` 靠 `Simulator.stats()` 读 `h`/`cells`/`tets`，一个 import 都不需要。
2. **`main.js`** — `createLatticeView`、`lattice` 解构、`latticeViews` 挂 `window`、日志打 `h=`。
3. **`body/` 与 `scene/`** — `resolution` 的文档单位与八个调用点的数值。
4. **`sim/solver/`** — `predict.wgsl:21` 与 `finalize.wgsl:84` 的注释里有 `lattice`。这个区域
   **已经在扫**，但用的是 `INTERACTION` 词表；`DISCRETISATION` 没扫它。
5. **`sim/state/`** — `particles.js:10` 的注释写「It is not a lattice corner」，`:28` 写
   「including inert ones」。这是**反向**用法（声明自己不知道），词表如果扩到这里会误伤。

判定要点：词表不能无脑扩到全仓库。`sim/constraints/`、`sim/debug/`、`sim/discretize/` **应该**
说 cell；`sim/state/`、`sim/solver/` 的注释里是**反向声明**。真正该扩的是 `ui/`、`main.js`、
`body/`、`scene/` 四处，而且 `render/` 的现有规则是唯一发挥了作用的机器检查，值得原样保留。

### 给 09（重构 spec）与 03（类型边界）

- **中立字段（四面体照搬，判定 A）**：`restPositions`、`invMass`、`nodeCount`、`mass`、
  `volume`。就这五个——`simulator.js:58-62` 递给 `Particles` 的三元组加上两个总量。
- **点阵专属（判定 C）**：`origin`、`h`、`cellDims`、`nodeDims`、`cells`、`colorRanges`。
- **中立的动作、专属的实现（判定 B）**：单元表、批次表、per-element 静止形状、边界节点集合、
  「一个代表性长度尺度」、采样器（位置 + 梯度）。
- **灰区，审计给出的判法**：
  - `nodeCount` — 数字中立，「稠密、含惰性」专属（第五栏坐实）。
  - `cells` + `colorRanges` — 「按批次投影」中立，「按奇偶分 8 色」专属；但注意跨物体合并
    dispatch（`elasticCells.js:114-134`）依赖的是「物体拥有不相交节点区间」，这条**中立**。
  - `bind.js` 采样器签名 — 参数包的不透明交接**真的挡住了 `render/`**（核实），但
    `corners.js` 与 `sample.js` 的 `LatticeSpace` 是缝的漏点，不用第二个采样器就能证。
  - `deformedNode(node)` — 中立成员的候选：任何离散化都有节点，`sim/debug/` 需要它。
- **`sim/constraints/` 站哪一侧**：**两侧都站**。`kinematicDrive.js` + 三个 Jacobi 内核纯中立；
  `elasticCells.js` + `cells.wgsl` + `project.wgsl` + `compliance.js` 是点阵后果；
  `bodyContact.js` + `broadphase.js` 是「中立骨架 + 点阵专属常量与证明」——半格球与桶容量硬界
  是专属的，Jacobi 收集/平均/施加是中立的。所以 03 的二选一（「承认约束是点阵后果」vs「拆成
  中立骨架 + 点阵核」）答案是**按文件分**，不是整个目录选一边。
- **`sim/grip.js` 防住了没有**：**防住了它声称要防的，没防住它没声称的**。手的尺寸（米为单位
  的 radius、不许写成 `h` 的倍数、不做 `coarsestCell()` 下钳）判定 **A**，一行不动。
  `worstCaseHeldNodes(radius, h)` 的界判定 **C**——它的证明是「节点各占一个不相交的 `h` 立方」。
  `:150-155` 的 node-index tie-break 判定 **A**（仍然需要，只是动机消失）。
  `DEFAULT_GRAB_RADIUS` 的下界「必须超过仓库里最粗的格子」判定 **B**（要换成某种代表性间距）。
