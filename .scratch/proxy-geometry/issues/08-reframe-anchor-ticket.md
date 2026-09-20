# 08 · 把锚定票的框架改对

Status: open
Type: task
Blocked by: 04, 05

## Question

`.scratch/physdreamer-alocasia/issues/01-anchor-mechanism.md` 现在那段「仓库里已经有两处和逆
质量为零有关的东西，但都不是这个意思 / 锚定是第三种意思」，本身就是被点阵扭曲的证据：它把一
个实现产物（惰性节点）和一族真实概念并排成三个平级的「含义」。

这张票用新词汇重写那段，**这是本图的验收样本**——如果新框架改不动它，说明框架没用。

### 改什么

- **标题**。如果 01 核实下来 `anchor` 不是物理引擎的一等术语（预判：不是，它在 Box2D 那边指
  「约束的附着点」，语义完全不同），标题跟着共识词改。
- **「背景」段**。按 04 定下的族名重写：一族概念 + 一个编码 + 一个不属于这族的实现产物，而不是
  三个平级含义。
- **候选段（a）/(b)/(c) 原样不动**。机制三选一不归本图（见地图 Out of scope）。
- 在票里加一行指向本图，说明它 blocked 在哪张图上，免得别的 session 顺手把三选一给选了。

### 顺带核对

`.scratch/physdreamer-alocasia/spec.md` 在本图开始时已按使用者决定暂停（`ready-for-agent` →
`needs-triage`）。这张票收尾时确认那个暂停标记还在，且理由指向本图。

（注：triage 词表里没有「blocked」这个状态，暂时借用 `needs-triage` 表达「别 AFK 捡起来」。
如果这个缺口值得补，那是 `docs/agents/triage-labels.md` 的事，不是本图的事。）

## Comments
