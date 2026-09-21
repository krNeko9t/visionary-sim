# 07 · 决策记录切到 docs/adr/

Status: open
Type: task

## Question

旧文档体系是使用者在接触 matt 这套 skill 之前自建的，两边在「决策记录」这个位置上撞车：
`docs/agents/domain.md` 要求领域决策进 `docs/adr/`，而 `CLAUDE.md` 已经把这个角色给了
`DECISIONS.md`。两个都留着，就是又一处「散乱、没有集中语义」。

使用者已决定：**用 `docs/adr/` 替代**，范围限定在决策记录这一格。这张票执行它。

### 做什么

1. 建 `docs/adr/`，格式见 `.claude/skills/domain-modeling/ADR-FORMAT.md`。
2. 写 ADR-0001：**决策记录从 `DECISIONS.md` 切到 `docs/adr/`**。这条 ADR 记的就是这次切换本身
   ——它满足「难以回退 / 无上下文会让人困惑 / 是真实取舍」三条。取舍要写清楚：为什么只换这一格
   而不换 `ARCHITECTURE.md`§四（根→后果结构平铺 ADR 表达不了）、为什么旧的 16 条不迁移。
3. `DECISIONS.md` **原地封存**：顶部加一行指向 `docs/adr/`，注明切换日期，内容一个字不改
   （那份文件自己规定「只追加不修改」，封存说明是追加不是修改）。
4. `CLAUDE.md` 的「项目文档规则」表改一行：`DECISIONS.md` 的角色降为历史/错误记录，新增
   `docs/adr/` 一行。**不**在 `CLAUDE.md` 里加任何关于点阵的规则（使用者已排除）。
5. 核对 `docs/agents/domain.md` 与改完之后的现实是否还一致；`test/unit/docs.test.js` 只双向核对
   §二的目录表与 `src/`，`docs/` 不在它的射程内，要确认这次改动不会碰红它。

### 不做什么

- 不建 `CONTEXT.md`（`domain.md` 要求懒创建，由 04 在第一个词条定下来时创建）。
- 不迁移 `DECISIONS.md` 的 16 条旧决策。
- 不动 `ARCHITECTURE.md`、不动 `STATUS.md`。

## Comments

### 05 的结论对本票的影响（2026-09-21）

- 第 2 步要写进 ADR-0001 的「为什么不换 `ARCHITECTURE.md`§四」**不再成立**：05 把 §四 的根改成
  逐条转 ADR，理由记在 [ADR-0004](../../../docs/adr/0004-architecture-roots-become-adrs.md)。
  ADR-0001 只记 `DECISIONS.md` → `docs/adr/` 这一次切换，并指向 0004。
- 编号：0001 仍留给本票；05 已用掉 0004、0005。
- `CLAUDE.md` 的 `ARCHITECTURE.md` 一行已被 05 改过（加了「细节写在代码旁边、可换的选择写成
  ADR」），改 `DECISIONS.md` 那一行时不要覆盖它。
