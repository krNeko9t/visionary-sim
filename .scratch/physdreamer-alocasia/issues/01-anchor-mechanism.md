# 01 · 锚定结论用什么机制写进点阵

Status: needs-triage
Type: grilling

> **2026-09-20 冻结**。这张票的「三种含义」叙述正在 `.scratch/proxy-geometry/map.md` 里被重新
> 定框；下面的候选 (a)/(b)/(c) **不要在那张图走完之前选**。框架改好之后由
> `proxy-geometry/issues/08-reframe-anchor-ticket.md` 重写本票的标题与背景段，候选段原样保留。

## 背景

`spec.md` 把"**谁**该被锚定"定死了：一个纯函数，节点周围一个格子 h 内没有任何可动点就锚定。
这张票只问剩下的半句——**这个结论用什么机制生效**。

锚定的物理含义是"这个节点的逆质量恒为零"。仓库里已经有两处和逆质量为零有关的东西，但都不是
这个意思：

- `lattice.invMass[n] === 0` 现在表示**惰性节点**——点阵是稠密的，那些角点周围八个格子都没有
  材料。`pick.js:36` 和 `grip.js:108` 都靠它跳过。
- `Particles.setPrescribed` / `clearPrescribed` 表示**此刻被某个驱动者规定**，是临时的，而且
  注释明写 "there is one driver at a time"（`particles.js:155-156`）。`KinematicDrive` 是它
  唯一的用户，抓取松手就还回去。

锚定是第三种意思：**永久的、没有持有者的、在离散化的那一刻就确定的**。

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
