# 决策记录从 `DECISIONS.md` 切到 `docs/adr/`

仓库原有一份自建的 `DECISIONS.md`（单文件、按日期、只追加），后来接入的 domain-modeling 约定要求
决策进 `docs/adr/`（一条一个文件、编号递增）。两处都留着，读的人就要先猜一条决策该去哪边找。
从 2026-09-21 起新决策只写 `docs/adr/`；`DECISIONS.md` 原地封存，只读，不再追加。

只换「决策记录」这一格。当初另一条不换的理由——`ARCHITECTURE.md`§四的根→后果结构平铺 ADR 表达
不了——已被 [ADR-0004](0004-architecture-roots-become-adrs.md) 推翻，§四 的根也逐条转成 ADR，
理由在那条里。

## Considered Options

- **两份并存，按领域 / 工程分工**。否掉：分界线正是读的人分不清的那条，撞车没有消失，只是搬家。
- **把旧的 14 条迁成 ADR**。否掉：每条记的是它写下那天为真的东西，带日期、带提交号，放在原处
  照样可查；转格式除了行数什么都不产生。
- **封存后仍往 `DECISIONS.md` 追加「判断错过的地方」**。否掉：那又是第二个入口。判断错了的后果
  是推翻某个决定，写成新 ADR，被否的方案与错在哪写进它的 Considered Options。

## Consequences

- 要推翻 2026-09-21 之前的某个决定时，仍要翻 `DECISIONS.md`；新 ADR 引用旧条目用它的日期标题。
