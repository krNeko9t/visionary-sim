# 02 · 四面体反事实审计

Status: open
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
