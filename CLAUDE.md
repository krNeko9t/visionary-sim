# 给 AI 的工作约定

## 项目文档规则

| 文件 | 写什么 | 范围 |
|---|---|---|
| `ARCHITECTURE.md` | 当前架构设计 | 不记录历史、进度 |
| `CLAUDE.md`（本文件） | AI工作规则 | 只写能改变某个具体动作的句子。认识/表述类的句子一律不写。保持精简|
| `DECISIONS.md` | 方案选择理由，判断分析，错误记录 | 过去时，带日期，只追加不修改 |
| `STATUS.md` | 记录里程碑 | 如果内容与最新任务无关，且确定收束就删。 |

## 工作规则

- 接受新需求时，把计划按里程碑写入STATUS.md，带上[]。

## 新增内容规则

- 新界面走 `ui/`，不在 `main.js` 里堆事件监听。
- `render/` 增加新表示法走 `deformation/bind.js`，不新写一份绑定。
- 新增目录：同时更新 `ARCHITECTURE.md` §二的表和 `test/unit/architecture.test.js` 的依赖表。
- 依赖表在architecture.test.js，改依赖表把理由追加进 `DECISIONS.md`。