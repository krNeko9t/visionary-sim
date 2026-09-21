# 12 · 抓取链上那五个词

Status: open
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
