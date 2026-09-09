# 上游数据的几何、实例对应与物性契约是什么

ID: 01
Parent: [场景级实例物性应用：纯前端接入决策地图](../map.md)
Labels: wayfinder:research
Type: research
Mode: AFK
Status: resolved
Assignee: codex/scene_upstream_research
Blocked by: none

## Question

核验用户给定脚本、源场景和 bench_504x336 结果，回答：

- 实际需要哪些输入文件；PLY 高斯顺序与 labels / valid 的对应是否由生产代码保证，能否校验错配？标签 0、无效点、未标注点各代表什么？
- 源 PLY 只有两个 scale 字段，其生成方式、几何语义和 opacity / rotation / SH 编码是什么？是否存在可核验的厚度信息；不能将补第三轴数值当成既定方案。
- 实例物性字段、SI 单位、缺失值、不确定性及实例 ID 的关联是什么？
- 坐标系、尺度、相机约定在文件或上游代码中能证实到哪一步？分清几何坐标与相机坐标，保留无法证实的部分。
- 数据规模、常驻数组的最低成本及现有加载、清洗入口会破坏的对应关系有哪些？

引用具体文件、行号与可复现的只读统计；不修改上游或原始数据，不代替后续决策选择二维输入的处理策略。

## Research context

- Branch: `research/scene-upstream-contract`
- Worktree: `/tmp/scene-upstream-contract`
- Commit: `f13361b`
- Asset: [bench 上游数据契约调查](../upstream-research.md)；同内容保存在研究分支根目录 `scene-upstream-research.md`。

## Answer

2026-09-09 · codex/scene_upstream_research 完成只读调查。完整证据、字段说明和复现脚本见研究资产。

- 最小消费输入为源 `point_cloud.ply`、`labels.npz`、`instance_physics.json`。本样本有 1,045,236 个高斯、九个正 ID 实例；0 是未追踪点，不能按背景类别丢弃。现场长度、valid 和逐实例数量吻合，但缺少内容哈希，不能保证同规模输入未错配或重排。
- 当前上游代码把两轴高斯作为 surfel / 2DGS 消费，未找到第三轴厚度或实体体积依据。当前加载器直接拒绝缺 scale_2 的文件；显示兼容与模拟体积策略交给[两轴高斯表面怎样显示并成为可模拟的实体](10-surface-to-volume.md)讨论。
- 物性 SI 字段为 rho_si（kg/m³）、E_si（Pa）、nu_si（无量纲）；不确定性字段不等于 SI 误差条，表格 trust 只由数量阈值生成。PLY 没有世界朝向或尺度依据，不能从 COLMAP 相机约定推断。
- 原三件套约 322 MB；报告提供具体数组内存公式，未实测浏览器峰值或性能。现有清洗会压紧行序而不保留实例映射，逐实例放置会破坏场景相对布局。
- 未运行上游、渲染或体素化，未读取 torch checkpoint，未证明本次导出对应的精确生成版本。研究问题已回答，缺失证据作为后续设计输入保留，不视为已保证可模拟。
