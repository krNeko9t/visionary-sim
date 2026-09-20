# 03 · 代理几何的类型边界

Status: open
Type: grilling
Blocked by: 02

## Question

画一条线：**哪些字段属于「代理几何」（任何离散化都有），哪些属于「体素点阵」（这一种实现才有）。**

这条线就是本图的目的地本身——线一划下来，点阵就从「那个位置上唯一的居民」降回「一个实现」。

要决定的：

- `discretizeBody()` 该返回什么？今天它直接返回 `Lattice`。
- 中立字段的清单：自由度位置（`restPositions`）、逆质量（`invMass`）、总质量、总体积……还有吗？
- 点阵专属字段的清单：`h`、`origin`、`cellDims`、`nodeDims`、`cells`、`colorRanges`……
- **灰区怎么判**。已知至少三处：
  - `nodeCount` 中立，但「稠密、含惰性节点」是点阵专属——同一个数字两种含义；
  - `cells` + `colorRanges` 是「单元 + 批次」的实例，四面体也有单元也要批次，但批次规则不同
    （奇偶 vs 运行时图着色）——中立的是「按批次投影」这件事，专属的是「按奇偶分 8 色」；
  - `deformation/bind.js` 的采样器签名：`deformH` / `deformCellDims` / `deformNodeDims` 是点阵
    的参数包，而「一个场能回答某点在哪、周围空间被拉成什么样」是中立承诺。
  - **`deformation/corners.js` 的 `CUBE_CORNERS`**（02 新发现）：它自称是「模拟侧与渲染侧必须
    约定的那一个约定」，住在 channel 里，`ALLOWED` 表还写着 `deformation` 不许依赖任何人——但
    它是立方体八角点的编号，判定 C，而且被 `discretize/lattice.js`、`discretize/kuhn.js`、
    `discretize/cloudVolume.js`、`debug/latticeView.js`、`deformation/sample.js` 五处 import。
    线画到哪一侧要连带决定它搬不搬去 `sim/discretize/`；搬了就要翻依赖表的方向（今天是
    `sim/discretize` → `deformation`），按 `CLAUDE.md` 要同步 `architecture.test.js` 并留 ADR。
    同一栏里 `deformation/sample.js` 的 `LatticeSpace` typedef（`origin`/`h`/`cellDims`）也是
    channel 内的点阵结构。
- `sim/constraints/` 站在线的哪一侧。如果 02 坐实了「换点阵要连约束一起重写」，那要么承认约束
  是点阵的后果（那 4.2 的边界要重画），要么把约束拆成中立骨架 + 点阵专属核。

## 02 已经带回来的（2026-09-20）

- **中立字段只有五个**（判定 A，四面体照搬）：`restPositions`、`invMass`、`nodeCount`、`mass`、
  `volume`。前三个正是 `simulator.js:58-62` 递给 `Particles` 的三元组。
- **点阵专属六个**（判定 C）：`origin`、`h`、`cellDims`、`nodeDims`、`cells`、`colorRanges`。
- **「缝是不是真的」这个问题不用等第二个采样器**。`shader` + `parameters` 的不透明交接**确实
  挡住了 `render/`**（五个 JS + 四个 WGSL 只转发参数、只调 `deformationAt`，判定 A，一行不动），
  这一半是真的。漏点是上面新增的那条灰区——现在就能证，不需要写出 `tetField()`。
- **`sim/constraints/` 站哪一侧：按文件分，不是整个目录选一边。** `kinematicDrive.js` 与三个
  Jacobi 内核纯中立；`elasticCells.js` + `cells.wgsl` + `project.wgsl` + `compliance.js` 是点阵
  后果；`bodyContact.js` + `broadphase.js` 是「中立骨架 + 点阵专属常量与证明」。所以本票原来的
  二选一有第三个答案。
- **`nodeCount` 的双义坐实了**：`Lattice.nodeCount` 含惰性节点，`Particles.nodeCount` 是各物体
  之和；四面体下两义合一。
- **中立成员的候选**：`sample.wgsl:206-208` 的 `deformedNode(node)`——任何离散化都有节点，
  `sim/debug/` 需要它，而 `bind.js` 今天明说它**不属于** field 的承诺。

清单细节见 [02 · 四面体反事实审计](02-tetrahedral-counterfactual.md)。

## 交付

使用者决定要**清单 + 类型草案**，不要只有清单：

- 类型草案写出中立类型的字段与文档注释、点阵实现如何提供它、`bind.js` 采样器的中立签名长什么
  样。草案落在本票的 `## Answer` 与下游 spec 里，**不落 `src/`**。
- 这条线定下来之后，`docs/adr/` 要有一条 ADR 记下它（由「文档体系切换」那张票建好目录）。

## Comments
