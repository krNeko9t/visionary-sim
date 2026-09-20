# 图 · 代理几何不再默认是体素点阵

Label: wayfinder:map

## Destination

给「模拟体的自由度是什么、自由度要服从什么」一个**不以体素点阵为默认**的框架：用无结构四面
体网格作为反事实撞出耦合清单，据此修正 `ARCHITECTURE.md` 4.2 的代价声明、建立领域词汇表、
把离散化护栏扩到该覆盖的区域，并产出一份「代理几何类型边界」的重构 spec。

锚定的**术语与语义**归本图（它是新框架的验收样本）；锚定的**机制落点**（`01-anchor-mechanism.md`
里的 a/b/c 三选一）不归本图，见 Out of scope。

## Notes

**领域**：WebGPU 上的 3DGS 软体模拟。XPBD 子步 + 稳定 Neo-Hookean，代理几何今天是均匀体素
点阵 + Kuhn 四面体切分。

**每个 session 先读**：本图 → `ARCHITECTURE.md`（尤其§三结构承诺与§四根结构）→ `CLAUDE.md`
→ `docs/agents/domain.md`。

**Skills**：默认 `grilling` + `domain-modeling`；`research` 票用 `research`。

**本图覆盖 wayfinder 的 plan-only 默认**（使用者 2026-09-20 决定）：

- 文档与护栏测试**就地改**：`ARCHITECTURE.md`、`CONTEXT.md`、`docs/adr/`、`CLAUDE.md`、
  `test/unit/architecture.test.js` 的改动直接落盘。
- `src/` 下**只允许一种改动**：护栏红转绿所需的最小改动（重命名、改标签、搬一次 import）。
  其余重构一律只出 spec，不落盘。

**试金石只有一个**：无结构四面体网格。选它是因为它能把 4.2（点阵）从 4.3（XPBD + 本构）里
隔离出来——保留单元与本构，只拿掉「规则」。1:1 点云被排除（撞掉的东西太多，清单没有分辨率）。

**词汇表只收领域概念**。实现产物（惰性节点、格子、色批）不进 `CONTEXT.md`，它们的位置是
`ARCHITECTURE.md` 4.2 的后果表。

**决策记录写 `docs/adr/`**，不再写 `DECISIONS.md`（后者原地封存，不迁移）。

## Decisions so far

<!-- 每张关闭的票一行：结论要旨 + 指针。细节留在票里，本图不复述 -->
- [01 · 行业里怎么称呼「被规定的自由度」](issues/01-boundary-condition-vocabulary.md)：族名定为 `prescribed`，下分 static（永久，原「锚定」）与 kinematic（临时，KinematicDrive）；`anchor` 全行业指「约束的附着点」且仓库 `grip.js` 已占用，弃用；「惰性节点」共识词是 `inactive node`，但它属 4.2 后果、不入族。

## Not yet specified

- **「只在某个方向上被规定」的自由度说不出来**。`invMass` 是标量，等于假定一个自由度要么整个
  被规定、要么整个自由；Baraff-Witkin §5.1 用 3×3 质量矩阵表达「只在法向被约束」。01 带回来
  的这条不在原图里。等「代理几何的类型边界」画完线、「被规定的自由度这一族的名字」定完族名，
  它才具备开票的锐度。
- **自由度必须与被渲染的几何同源吗**。PhysDreamer 自己用的是降采样的无结构驱动子，不是与点云
  同源的网格。这个问题被排除在本轮试金石之外，等 PhysDreamer 场景真的回来再说。
- **「批次规则属于每一种约束自己」这条承诺要不要重述**。如果审计证明 `sim/constraints/` 整体
  随点阵而变（8 色分批、半格球都是 4.2 的后果），那么这条承诺的边界就比文档写的窄。等
  「四面体反事实审计」出清单。
- **`deformation/bind.js` 那道缝是不是真的**。`latticeField` 是今天唯一的采样器，缝只被声明过
  没被验证过；可能需要第二个采样器的签名才能证明。等「代理几何的类型边界」。
- **`STATUS.md` 与 issue tracker 的重叠**。11a 把它挡在本图之外，但重叠没有消失。

## Out of scope

- **锚定机制的落点**（`01-anchor-mechanism.md` 的 a/b/c 三选一、改哪个文件、缝架在哪）。
  下一张图。本图只把那张票的框架改对。
- **真的实现第二个离散化后端**（四面体或点云）。这是本图最后那份 spec 的下游。
- **PhysDreamer 场景接入的其余部分**（离线脚本、坐标系、零重力）。与本图正交，整份 spec 已
  按使用者决定暂停。
- **1:1 点云作为试金石**。撞掉的东西跨了两个根，产出的清单分不清哪些是 4.2 的错。
- **写给 agent 的 `CLAUDE.md` 防歪规则**。使用者明确不要。
- **把 `ARCHITECTURE.md` §四拆成 ADR**。§四的「根→后果」结构是平铺 ADR 表达不了的，拆掉会毁掉
  本仓库少数做对了的地方。
- **迁移 `DECISIONS.md` 的 16 条旧决策**。过去时的记录，转格式除了行数什么都不产生。
