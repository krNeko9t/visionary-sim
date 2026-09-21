# 12 · 抓取链上那五个词

Status: resolved
Type: grilling
Blocked by: 04

## Question

`pick` / `grip` / `grab` / `drive` / `handle` 五个词分布在五个文件里，指的是**五个概念**，还是
**一条链上的五个阶段**？哪些该进 `CONTEXT.md`，哪些只是函数名？

今天的分布：

| 词 | 在哪 | 今天指什么（读代码得到的印象） |
|---|---|---|
| `pick` | `sim/pick.js` | 射线找出最近的那个节点（`nearestNodeToRay`） |
| `anchor` | `sim/pick.js` 的返回值、`simulator.js:389-411`、`drive.wgsl:22` | 射线打中的**那个**节点。04 已定名为「锚点」，进了 `CONTEXT.md` |
| `grip` | `sim/grip.js` | 从锚点扩出**一团**节点的策略（`singleNode` / `withinRadius`） |
| `grab` | `ui/grab.js` | 人这一侧的动作：按下、拖、松手 |
| `drive` | `kinematicDrive.js`、`driveHard.wgsl`、`driveCompliant.wgsl` | 把那团节点按目标移动的约束与它的核 |
| `handle` | `driveHard.wgsl` 的 `handleVelocity` | 被拖的那个东西本身的速度 |

## 为什么值得单开一票

- **04 已经收了 `anchor`**，它是这条链的第一环，且是因为**撞名**才被收的。链上其余四个词没被
  同一次审视过，等于只清了一半。
- **`ARCHITECTURE.md` 4.6 是一条独立的根**（「抓的是一团世界空间里的材料，不是一个自由度」），
  这五个词是那条根的词汇，不是 4.2 的后果。拿 04 的判据（只收有歧义或已撞名的）去筛它们，需要
  先把「它们到底是不是同一个概念的不同阶段」问清楚——04 没有把握，塞进 04 会把它做浅。
- **`grip` / `grab` 在英文里几乎是同义词**，却分别住在 `sim/` 与 `ui/` 两侧。这是「同义词跨层
  撞车」，正是词汇表该管的那类问题。

## 要决定的

1. 这五个词是五个概念还是一条链的五个阶段；
2. 其中哪些达到「有歧义或已撞名」的收录门槛（`grip` / `grab` 几乎肯定达到）；
3. 达到门槛的，`_Avoid_` 写什么。

## 交付

追加进 `CONTEXT.md` 的「自由度要服从什么」组，或者按需新开一个组。理由若构成取舍，追加一条
ADR；若只是「挑了个更好的词」，不写 ADR。

## Comments

### 13 的结论对本票的影响（2026-09-21）

- 4.6 已转成 [ADR-0011](../../../docs/adr/0011-grip-takes-a-world-space-ball-of-material.md)。
  半径上下界只在 `sim/grip.js` 里；ADR 留的是跨模块的三条（只抓被点中的物体、容量截断、球不是
  测地邻域）。原文「集合容量来自 4.1 提到的固定缓冲」是悬空引用，4.1 从没提过。

## Answer

**票面那张表有两处错**：`grab` 不只在 `ui/`——`Simulator.grab()` 一次做完找锚点、扩握持、`drive.hold()`，
`moveGrab`/`releaseGrab` 也在 `sim/`，它指的是**整次交互**；另有第六个词 `hold`（`KinematicDrive.hold`、
「held set」），即 `CONTEXT.md` 里的「持有者」。

1. **不是五个概念，也不是五个阶段**：三个领域概念 + 两个动作 + 一个已收的词。
   `pick`、`drive` 是动作/代码名，不收；锚点 04 已收；收三条——**抓取**（交互）、**握持物**（被带走
   的材料）、**抓取目标**（世界空间里被拖的点）。
2. **收录**：以上三条，追加在「自由度要服从什么」组的「锚点」之后。`pick` 无撞名，不收。
3. **`_Avoid_`**：
   - 抓取：不指被带走的材料；**被抓住 ≠ 被规定**——柔律下握持物仍被解出，只有硬律经
     `setPrescribed` 让它成为运动学规定。
   - 握持物（英文 `Gripped part`，使用者定）：`grip` 不当动词用，这正是 grip/grab 同义撞车的拆法；
     大小不用节点数说（ADR-0011）。
   - 抓取目标（使用者提出以 `grabTarget` 代替 `handle`）：`handle` 撞资源句柄（`bind.js:63`、
     `attachGrabber` 的返回值），且 `kinematicDrive.js` 的「handle anchor」把锚点和它粘在一起；也不读成
     每个节点各自的目标——那是它加上各自偏移。

「运动学规定」条目里的「持有者」**保持泛指**，抓取只是今天唯一的一种，不把定义焊在指针上。

**不写 ADR**：挑了更好的词，没有难以回退的取舍；分界的理由已在 ADR-0002 / ADR-0011。

**不动 `src/`**：代码改名（`handle*`→`grabTarget*`、`Grip`→`GrippedPart`、`DEFAULT_GRAB_RADIUS`、
「handle anchor」）作为一条追加进 [`spec.md`](../spec.md) 第 7 步。
