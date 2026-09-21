# 图 · 代理几何不再默认是体素点阵

Label: wayfinder:map
Status: resolved

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
- [06 · 离散化词表的覆盖面](issues/06-discretisation-word-list-coverage.md)：词表扫全仓库，唯一居民 `sim/discretize/lattice/`（尚不存在，规则照样对着它写）；今天仍说点阵的 33 个文件逐个进 `DISCRETISATION_DEBT`，另一条测试让已还清的条目变红，所以债单只减不增——它就是 4.2 那句代价声明的机器版，也是 09 的验收清单。`body/`、`scene/` 实测今天就红（`resolution` 的单位），进债单；`sim/state` 的反向声明改写而不豁免；三处 `inert` 意为「此刻不被解算」，按 ADR-0003 改写而非改名。
- [07 · 决策记录切到 docs/adr/](issues/07-decision-log-switch.md)：ADR-0001 落盘，`DECISIONS.md` 原地封存为完全只读（错误记录也不再追加，写进推翻它的新 ADR）；`CLAUDE.md` 表与「改依赖表」规则改指 `docs/adr/`，`ARCHITECTURE.md` 只改了开头指针。旧条目实为 14 条。
- [08 · 把锚定票的框架改对](issues/08-reframe-anchor-ticket.md)：验收样本通过。锚定票改名「静态规定的自由度用什么机制生效」，背景重写成一族（运动学已有、静态待建，分界是归属）+ 一个编码（`gpuInvMass` 的零，ADR-0003）+ 一个不入族的惰性节点；判据只摆出不改（世界空间 vs 用 h 表达，官方阈值其实也挂 `grid_size`）。撞出：三个候选的编码那一步全踩 ADR-0003，真正区分它们的是「哪一层交出结论」那根轴——记在票里「读候选前」一节，原文未动。
- [09 · 代理几何重构 spec](issues/09-refactor-spec.md)：交付 [`spec.md`](spec.md)，七步、先接口后搬家，完成标准是债单清空；新增一致性测试作为第二个后端的准入门。`resolution` 换成世界空间的 `elementSize`。撞出：**接触用球是一个可换的选择**（ADR-0008），03 的接口条目 2 与密封不变量降级为「球模型的准入条件」；以及 03 漏掉的依赖翻转 `sim/discretize → sim/constraints`。ADR-0006/0007 落盘。第 5 步等 11；地图等 10–13 关闭再关。
- [10 · 「批次规则属于每一种约束自己」这条承诺的边界](issues/10-batching-commitment-scope.md)：§三 逐句过开头那条检验，不过的**删掉、不加限定**（11 套用）。推论只留归属，奇偶分色与 Jacobi 两个例子删去（已在代码旁边）；「第三种约束」那句改成不数种数、不写编码，并分开运动学驱动（是约束）与它造出的被规定自由度（不是）。不写 ADR、护栏表不加行、重构后的目录变化归 spec。
- [11 · §三第一条承诺与线框渲染路径](issues/11-commitment-one-and-wireframe-path.md)：「表示法」「渲染路径」都不是概念——渲染器只拿「静止空间几何 + 形变场」，按图元画、不知道几何从哪来，线框只是又一份被带动的几何。「唯一交集」与「两种表示法并列」两段删掉（保证仍由分层强制，不降级；mixed 是演示不是验收），§二 `render/` 行与§四 那一行改成不数种类；测试改动写进 spec 第 5 步。不收词、不写 ADR。
- [12 · 抓取链上那五个词](issues/12-grab-chain-vocabulary.md)：三个概念两个动作——`CONTEXT.md` 收**抓取**（交互，今天唯一的持有者）、**握持物 / Gripped part**、**抓取目标 / Grab target**（代替 `handle`）；`pick`/`drive` 只是代码名。撞出：`grab` 在 `sim/` 里就指整次交互；**被抓住 ≠ 被规定**（柔律下握持物仍被解出）。不写 ADR，代码改名进 spec 第 7 步。
- [13 · §四 其余各根转成 ADR](issues/13-remaining-roots-to-adr.md)：§四 整节删除。4.1 → ADR-0009、4.3 → ADR-0010、4.6 → ADR-0011，各只留跨模块后果；4.4（三线性是点阵的后果、不难回退）与 4.5（无真实取舍，原文还数错了平面、放错了目录）直接删；欠账表三行都被代码注释反驳，整张删。开篇改为「§一到§三是结构，选择各是一条 ADR」并给出按地基往上的 ADR 阅读顺序，编号不重排。0009/0010 的原始理由查无记录，如实写明。

## Not yet specified

（空。三块雾在关图时移入 Out of scope。）

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
- **把接触换成表面三角形接触**（点撞面、边撞边）。09 撞出接触用球是一个可换的选择
  （ADR-0008），不是代理几何的后果；换它是重写接触窄相，比本图的重构还大，与「代理几何不再
  默认是体素点阵」正交。
- **迁移 `DECISIONS.md` 的 14 条旧决策**。过去时的记录，转格式除了行数什么都不产生。
- **`scene/` 一个目录装了两件事**（`scenes.js` 跑什么、`stage.js` 周围画什么）。关图时仍无撞名，
  够不上词汇表门槛；是目录划分问题，与「代理几何不再默认是体素点阵」正交。
- **自由度是否必须与被渲染的几何同源**。PhysDreamer 用降采样的无结构驱动子，但这个问题不被本图的
  试金石撞出；随 PhysDreamer 场景接入一起回来。
- **`STATUS.md` 与 issue tracker 的重叠**。11a 已把它挡在本图之外，是仓库文档流程的事，不是代理几何的事。
