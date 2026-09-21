# 01 · 静态规定的自由度用什么机制生效

Status: needs-triage
Type: grilling

> **2026-09-20 冻结，blocked 在 [代理几何不再默认是体素点阵](../../proxy-geometry/map.md) 这张图上**。
> 标题与背景段已由那张图的 [08 · 把锚定票的框架改对](../../proxy-geometry/issues/08-reframe-anchor-ticket.md)
> 按新词汇重写（2026-09-21）；下面的候选 (a)/(b)/(c) **不要在那张图走完之前选**。
> 词条见根目录 [`CONTEXT.md`](../../../CONTEXT.md)，族名与编码规则的理由见
> [ADR-0002](../../../docs/adr/0002-prescribed-degrees-of-freedom.md)、
> [ADR-0003](../../../docs/adr/0003-material-inverse-mass-means-inactive-only.md)。
> 旧标题「锚定结论用什么机制写进点阵」弃用：`anchor` 在本仓库指**锚点**（约束附着在物体上的
> 那个点，`grip.js`），而「写进点阵」把今天唯一的一种代理几何当成了问题的一部分。文件名没改，
> 免得断链。

## 背景

`spec.md` 把「**哪些**自由度被静态规定」定死了：一个纯函数，节点周围一个格子 h 内没有任何
可动点，这个节点的自由度就被规定。这张票只问剩下的半句——**这个结论用什么机制生效**。

### 一族概念：被规定的自由度

位移由外部规定、不由求解器解出的自由度。按**归属**分两种，「永久 / 临时」是归属推出来的后果，
不是区别本身：

- **运动学规定**——归属于一次交互。今天已经有：`Particles.setPrescribed` / `clearPrescribed`
  （`particles.js:160,166`），`KinematicDrive` 是它唯一的持有者，松手即归还。契约写明
  "there is one driver at a time"（`particles.js:156`）：新的一批直接替换上一批。
- **静态规定**——归属于物体本身，没有持有者，因而没有任何东西可以松手把它放回去。今天**不存在**，
  这张票要的就是它。

两者是同一族的两个成员，不是两种「含义」。

### 一个编码

两者最终都读作同一个零：`Particles.uploadGpuMasses()`（`particles.js:194`）把材料 `invMass`
与被规定集合**单向合成**进 `gpuInvMass`，求解器读合成结果——零表示「此刻不被解算」。

共用编码不是问题。ADR-0003 定的规则是：**材料数组里的零只表示惰性；被规定的自由度——无论静态
还是运动学——从不写进材料数组。** 纠缠只会在把不同归属的东西写进同一个数组时发生。

### 一个不属于这族的实现产物：惰性节点

`lattice.invMass[n] === 0` 表示**惰性节点**（inactive node）：点阵是稠密的，那些角点周围八个
格子都没有材料。它不是被规定——它压根没有质量，是体素点阵这种代理几何的后果
（[ADR-0005](../../../docs/adr/0005-voxel-lattice-proxy-geometry.md)），换成无结构四面体网格它
就不存在。`pick.js:36` 与 `grip.js:108` 读材料数组跳过它，注释「A node with no material never
moves」今天是真话。

这张票的旧版本把它和上面两个并排成「三种含义」，那是点阵扭曲出来的：一个实现产物和一族领域
概念不在同一层。

### 判据：只摆出来，归下一张图

旧版本说静态规定「在离散化的那一刻就确定」。这句要拆开读：被规定的**节点集合**只能在离散化之后
求出（节点那时才存在），但**判据**是物体的性质，说的是世界空间里的一团材料。

PhysDreamer 自己的固定区域就不是在离散化那一刻定的：`demo.py:348-365` 的 `find_far_points`
按到 `moving_part_points.ply` 的**世界空间距离**去选，形状更接近 `grip.js` 的「世界空间里一团
材料」。（它的阈值写成 `0.5 / grid_size`，也和网格尺寸挂钩——「官方判据同形」这句话在下一张图
里要连这一点一起核实。）而 `spec.md` 的判据是「节点周围一个格子 h 内」——**用格子长度表达的
判据**，正是 `grip.js` 整份文件在防的东西。

**本票不改判据**，也不改 `spec.md`；判据归下一张图。

### 读候选前

下面 (a)/(b)/(c) 是冻结前的原文，一个字没改（原文里的「锚定」读作**静态规定**）。但它们写在
ADR-0003 之前，三条在**编码那一步**都踩了它：

- (a) 把命中节点的 `invMass` 置零——那是点阵的材料数组；
- (b) 直接改 `particles.invMass`——那是 `Particles` 的材料数组；
- (c) 让新约束借用现有的 `prescribed` 集合——ADR-0003 否掉的第二个落点，第一次抓握就会把它擦掉。

ADR-0003 给的落点是第三个位置：与 `prescribed` 并列、一起合成进 `gpuInvMass`。三个候选真正
互不相同的是**另一根轴**——判据的结论由哪一层交出、从哪条路走进 `Particles`（物体字段 +
离散化 / 应用层直接写 / 求解器派发序列里的一条约束）。那根轴本图不碰。选之前要重看的：

- (a) 的「已核实的白送行为」里，`pick.js:36`、`grip.js:108`、`relumpMasses` 三条靠的是材料数组
  读零。静态规定不写进材料数组之后，它们不再白送——「花盆天然抓不动」要重新论证。
- (a) 的「代价」引的那句「a body does not know it will be cut into cells」已经不在
  `ARCHITECTURE.md` 里（05 把 §四 瘦掉了），仓库里也找不到了；它要求的那个论证本身仍然成立：
  这个字段说的是物体自己的性质，还是模拟侧的选择。
- (c) 的第二条代价（约束回答「服从什么」，静态规定回答「有没有自由度」）与 `CONTEXT.md` 对
  「约束」取的窄义一致，照旧成立。

## 候选

### (a) 点阵级：`SoftBody` 加一个可选字段，`sim/discretize/` 加一个函数

判据（一个函数或一组点）作为可选字段挂在 body 上，`discretizeBody` 建完点阵后调用一次
`anchorNodes(lattice, 判据)`，把命中节点的 `invMass` 置零。判据本身留在应用层，核心只知道
"有些自由度不是自由的"。

核心新增面：`body/softBody.js` 一个字段、`sim/discretize/discretize.js` 一个函数一行调用。
`sim/discretize/lattice.js` 不动。

**已核实的白送行为**（对着代码看过，不是推测）：

- `pick.js:36` / `grip.js:108` 本来就跳过 `invMass === 0`，所以花盆天然抓不动，抓叶子时球里
  的锚定节点天然不被拖走。
- `relumpMasses`（`discretize.js`）对 `invMass` 乘一个比例，`0 × ratio` 仍是 0，改密度不会
  把锚定解开。
- `project.wgsl:76` 已有 `w0 + w1 + w2 + w3 == 0 → continue`，整格锚定不会除零。
- `Particles` 构造时 `gpuInvMass` 从 `invMass` 拷贝、每次 `uploadMasses` 重算
  （`particles.js:195`），所以和 `setPrescribed` 正交：抓取松手不会把锚定还回去。
- 锚定节点作为接触面节点仍然进窄相，表现为不动的碰撞体。

**代价**：`SoftBody` 多了一个字段，而 `ARCHITECTURE.md` 说"a body does not know it will be cut
into cells"。需要论证这个字段说的是"这个物体有一部分是钉住的"（物体自己的性质）而不是"这个
点阵要这么切"（模拟侧的选择）。

### (b) 零核心改动：应用层构造完 `Simulator` 之后直接改 `particles.invMass` 再 `uploadMasses()`

技术上可行（同一组已核实的事实支持它）。零核心改动，完全符合"收束到应用层"。

**代价**：这正是 `DECISIONS.md` 2026-08-12 那条决策花一整条篇幅拆掉的形状——当年的 `grabNode`
就是这么活的：一个贯穿层的特权通道，读写别人的普通字段，任何 import 检查都看不见。
`architecture.test.js` 的 `INTERACTION` 词表就是为了挡住它长回来而加的。这条路会在同一个位置
重新开一个洞，只不过这次开洞的是 `scene/` 而不是 `sim/solver/`。

### (c) 第四种约束 `Anchors`

和 `ElasticCells` / `BodyContact` / `KinematicDrive` 平级，零速度版。

**代价**：被 `setPrescribed` 的"一次一个驱动者"挡住——抓取会清掉锚定。要并存就得改那个刻意
最小的中立能力，让它认识多个持有者。而且约束回答的是"自由度要**服从**什么"，锚定回答的是
"这里**有没有**自由度"，塞进 `sim/constraints/` 名不副实。

## 要决定什么

三选一。我倾向 (a)，理由是它是三者里唯一既不泄露 physdreamer 语义、又不重建特权通道的；
但 (a) 是唯一需要碰核心的一条，而"收束到应用层"这条约束是使用者定的，所以这个取舍归使用者。

决定之后这张票就是可交付的实现工作，缝跟着落点走：(a) 落 `discretize.test.js` 或
`lattice.test.js`，(b) 没有缝可架（这本身是反对它的一条理由），(c) 落
`kinematicDrive.test.js` 旁边一份新的契约测试。

## Comments
