# 给 AI 的工作约定

## 项目文档规则

| 文件 | 写什么 | 范围 |
|---|---|---|
| `ARCHITECTURE.md` | 当前架构设计 | 不记录历史、进度。只对打开某一个模块的人有用的细节写在那个模块的代码旁边，不写进这里；可换的选择写成 `docs/adr/` |
| `CLAUDE.md`（本文件） | AI工作规则 | 只写能改变某个具体动作的句子。认识/表述类的句子一律不写。保持精简|
| `docs/adr/` | 方案选择理由，被否的方案，判断错在哪 | 一条一个文件，编号递增；推翻旧决定写新的一条 |
| `DECISIONS.md` | 2026-09-21 之前的决策与错误记录 | 封存，只读，不再追加 |

## 新增内容规则

- 新界面走 `ui/`，不在 `main.js` 里堆事件监听。
- `render/` 增加新表示法走 `deformation/bind.js`，不新写一份绑定。
- 新增目录：同时更新 `ARCHITECTURE.md` §二的表和 `test/unit/architecture.test.js` 的依赖表。
- 依赖表在architecture.test.js，改依赖表把理由写成 `docs/adr/` 的一条 ADR。
- `test/kernel-boundary/exemptions.js` 只删不加：修掉内核违规的同一个变更里删掉或调低对应行；新代码不靠加豁免通过。
- 改写计算后端、着色器绑定这类不该改变物理行为的改动，提交前在 4090 上跑 `test/motion-reference/` 比对；有意改变物理行为时按它的 README 重录。

## Agent skills

### Issue tracker

Issue 和 spec 以 markdown 文件放在 `.scratch/<feature>/`。见 `docs/agents/issue-tracker.md`。

### Triage labels

五个默认标签（needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix）。见 `docs/agents/triage-labels.md`。

### Domain docs

单 context：根目录 `CONTEXT.md` + `docs/adr/`。见 `docs/agents/domain.md`。
