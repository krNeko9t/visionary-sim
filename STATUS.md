# 当下状态

## 待评估问题

- 接触计算与 splat 画质/过绘制存在性能优化需求；需要重新评估后再决定方案，目前不安排实施。
- `timestep.js` 的 `MAX_STEPS_PER_FRAME=24` 按当前最吃紧场景硬编，`FixedTimestep` 已接受
  `maxStepsPerFrame` 构造参数但没有场景/UI 接入。目前没有场景需要更高预算，出现前不安排实施。
