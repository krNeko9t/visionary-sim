# 图 · 代理几何不再默认是体素点阵

Label: wayfinder:map

## Destination

给「模拟体的自由度是什么、自由度要服从什么」一个**不以体素点阵为默认**的框架：用无结构四面
体网格作为反事实撞出耦合清单，据此把 `ARCHITECTURE.md` 瘦成只装跨模块结构（§四 的根转成
ADR，细节留在代码旁边）、建立领域词汇表、把离散化护栏扩到该覆盖的区域，并产出一份「代理几何
类型边界」的重构 spec。

锚定的**术语与语义**归本图（它是新框架的验收样本）；锚定的**机制落点**（`01-anchor-mechanism.md`
里的 a/b/c 三选一）不归本图，见 Out of scope。

## Notes

**领域**：WebGPU 上的 3DGS 软体模拟。XPBD 子步 + 稳定 Neo-Hookean，代理几何今天是均匀体素
点阵 + Kuhn 四面体切分。

**每个 session 先读**：本图 → `ARCHITECTURE.md`（尤其§三结构承诺）→ `docs/adr/` → `CLAUDE.md`
→ `docs/agents/domain.md`。

**Skills**：默认 `grilling` + `domain-modeling`；`research` 票用 `research`。

**本图覆盖 wayfinder 的 plan-only 默认**（使用者 2026-09-20 决定）：

- 文档与护栏测试**就地改**：`ARCHITECTURE.md`、`CONTEXT.md`、`docs/adr/`、`CLAUDE.md`、
  `test/unit/architecture.test.js` 的改动直接落盘。
- `src/` 下**只允许一种改动**：护栏红转绿所需的最小改动（重命名、改标签、搬一次 import）。
  其余重构一律只出 spec，不落盘。

**试金石只有一个**：无结构四面体网格。选它是因为它能把 4.2（点阵）从 4.3（XPBD + 本构）里
隔离出来——保留单元与本构，只拿掉「规则」。1:1 点云被排除（撞掉的东西太多，清单没有分辨率）。

**词汇表只收领域概念**。实现产物（惰性节点、格子、色批）不进 `CONTEXT.md`，也不进
`ARCHITECTURE.md`：它们的位置是逼出它们的代码旁边（ADR-0004）。

**决策记录写 `docs/adr/`**，不再写 `DECISIONS.md`（后者原地封存，不迁移）。

## Decisions so far

<!-- 每张关闭的票一行：结论要旨 + 指针。细节留在票里，本图不复述 -->
- [01 · 行业里怎么称呼「被规定的自由度」](issues/01-boundary-condition-vocabulary.md)：族名定为 `prescribed`，下分 static（永久，原「锚定」）与 kinematic（临时，KinematicDrive）；`anchor` 全行业指「约束的附着点」且仓库 `grip.js` 已占用，弃用；「惰性节点」共识词是 `inactive node`，但它属 4.2 后果、不入族。
- [02 · 四面体反事实审计](issues/02-tetrahedral-counterfactual.md)：代价声明错两次——跟着走的是 `sim/constraints/` 四文件重写 + 四文件改证明、`simulator.js`、`deformation/`（含 channel 里的 `CUBE_CORNERS`）、`sim/debug/` 整份、以及 `body/`/`scene/`/`main.js`/`ui/`（`resolution` 的单位）；守住的只有 `sim/state/` 与 `render/`。漏网的承重假定：稠密索引寻址（惰性节点是它的后果）、静止形状全等、接触桶容量硬界依赖最小节点间距、点定位是一次除法。B/C 两档的分界线就是拆根的位置。
- [03 · 代理几何的类型边界](issues/03-proxy-geometry-type-boundary.md)：`Lattice` 拆成中立 `ProxyGeometry` 与住在 `sim/discretize/lattice/` 的 `VoxelLattice`，11 个公开字段换成 9 条接口条目（含 6 条不变量）。中立的 `ElasticCells` 不再存在，离散化直接交出自己的弹性约束；接触收「边界节点 + 每节点密封半径」而非约束，判据是「约束是否跨物体耦合」；采样器三件搬出 `deformation/`，`deformedNode` 不进中立契约；线框调试视图升为一条渲染路径（`wireframe()`），`sim/debug/` 目录消失。`spacing` 与 `cflLength` 必须是两条——它们在点阵上都读作 `h` 纯属均匀网格的巧合。
- [04 · 「被规定的自由度」这一族的名字](issues/04-prescribed-dof-family.md)：族名收伞为 `prescribed`，下分 static（属于物体）与 kinematic（属于一次交互）——分界轴是**归属**，「永久/临时」是它推出来的后果、不写进词汇表；族定义对方向性保持中立。规则：**材料数组里的零只表示惰性，被规定从不写进材料数组**，于是「共用一个编码」不是纠缠的根因、把不同归属的东西写进同一个数组才是。产出根目录 `CONTEXT.md`（9 条）与 ADR-0002/0003；连带收窄 03 的 I1，`inert`→`inactive` 交给 06。
- [05 · 4.2 该在 `ARCHITECTURE.md` 里留下什么](issues/05-root-4-2-cost-and-structure.md)：原问（修代价声明、挂九条后果、拆根）被使用者整体推翻——病根是 §四 在复述代码。判据改为「只对打开某个模块的人有用的写在模块旁边，跨模块的才进 ADR」：4.2 删除、转成 ADR-0005，代价声明不再写成文字、由 06 的词表测试兑现；ADR-0004 记下这条规则并推翻本图原先「不把 §四 拆成 ADR」的边界。其余各根 → 13。

## Not yet specified

- **`scene/` 一个目录装了两件事**：`scenes.js`（这一次跑什么）与 `stage.js`（周围画什么），
  §二那一行已经把它们并列写着。「场景」与「环境」是不是两个词，04 判定够不上首批的收录门槛
  （没有撞名），但也没有看清楚。比 12 更暗一档。
- **自由度必须与被渲染的几何同源吗**。PhysDreamer 自己用的是降采样的无结构驱动子，不是与点云
  同源的网格。这个问题被排除在本轮试金石之外，等 PhysDreamer 场景真的回来再说。
- **`STATUS.md` 与 issue tracker 的重叠**。11a 把它挡在本图之外，但重叠没有消失。

## Out of scope

- **锚定机制的落点**（`01-anchor-mechanism.md` 的 a/b/c 三选一、改哪个文件、缝架在哪）。
  下一张图。本图只把那张票的框架改对。
- **真的实现第二个离散化后端**（四面体或点云）。这是本图最后那份 spec 的下游。
- **PhysDreamer 场景接入的其余部分**（离线脚本、坐标系、零重力）。与本图正交，整份 spec 已
  按使用者决定暂停。
- **1:1 点云作为试金石**。撞掉的东西跨了两个根，产出的清单分不清哪些是 4.2 的错。
- **写给 agent 的 `CLAUDE.md` 防歪规则**。使用者明确不要。
- **把标量 `invMass` 换成 3×3 质量矩阵**（「只在某个方向上被规定」，Baraff-Witkin §5.1）。
  原本是本图的一块雾，04 把它挪出来：04 已定下方向性是 prescribed 族的一个**维度**，且
  `CONTEXT.md` 的族定义对它保持中立，所以将来加它改的是实现、不是定义。而标量换 3×3 在点阵上
  和在四面体网格上**是同一个问题**——它不被试金石撞出来，与「代理几何不再默认是体素点阵」正交。
  性质同「真的实现第二个离散化后端」：那份 spec 的下游。
- **迁移 `DECISIONS.md` 的 16 条旧决策**。过去时的记录，转格式除了行数什么都不产生。
