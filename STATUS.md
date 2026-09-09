# 当下状态

## 里程碑

- [x] M1 · 场景级实例物性应用规划：核对现有架构与给定数据路径，和用户明确 wayfinder 终点。
- [x] M2 · 广度梳理数据准备、应用边界、实例转模拟、全局变换、手工碰撞体的待决问题。
- [x] M3 · 建立本地决策地图、10 张子票与阻塞关系；完成两张研究票，归档证据。
- [x] M4 · 与用户解决「场景实例应用与模拟渲染内核如何分工」，记录上游专属准备与失败保留契约，更新地图。
- [ ] M5 · 按前沿逐会话解决后续决策、展开新问题，直至实现前的路线清晰。

## 本次规划终点

- 用户已确认：形成可交给后续实现的规格与决策地图，覆盖数据准备、实例选择与转模拟、
  全局坐标校正、手工碰撞体，以及应用层与模拟/渲染内核的边界；本轮不实施功能。
- 上游脚本：`/home/liaowanjun/Projects/AnySplat/scripts/run_iggt_phys_pipeline.py`。
- 处理结果：`/home/liaowanjun/tmp/mx_runs/bench_504x336`。
- 源场景：`/home/liaowanjun/Datas/instascene_preprocessed_data/3dovs/bench`。
- 三处路径本机可读；后续以这些路径为准，不用结果元数据中的历史服务器路径替换。
- 用户确认全部纯前端；其余首版范围已记录在[决策地图](.scratch/scene-instance-app/map.md)。
- 已解决：[场景实例应用与模拟渲染内核如何分工](.scratch/scene-instance-app/issues/03-app-boundary.md)。
- 下一前沿：[坐标预设与手工校正怎样得到一致的物理世界](.scratch/scene-instance-app/issues/05-world-transform.md)，尚未认领；本会话不继续解决其他决策票。

## 待评估问题

- 接触计算与 splat 画质/过绘制存在性能优化需求；需要重新评估后再决定方案，目前不安排实施。
- `timestep.js` 的 `MAX_STEPS_PER_FRAME=24` 按当前最吃紧场景硬编，`FixedTimestep` 已接受
  `maxStepsPerFrame` 构造参数但没有场景/UI 接入。目前没有场景需要更高预算，出现前不安排实施。
