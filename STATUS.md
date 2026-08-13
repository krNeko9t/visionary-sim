# 当下状态

## 里程碑

- [x] M1 · 抓取从特权通道改成一等约束 `KinematicDrive`：`sim/state`、`sim/solver`
      不再出现抓取词汇，硬运动学 / 柔顺手柄两种驱动律可切换
- [x] M2 · 抓取语义脱离点阵分辨率：`sim/grip.js` 新增世界空间半径范围抓取
      `withinRadius`，与 `singleNode` 并列可切换，默认 `withinRadius`

## 待评估问题

- 接触计算与 splat 画质/过绘制存在性能优化需求；需要重新评估后再决定方案，目前不安排实施。
- `timestep.js` 的 `MAX_STEPS_PER_FRAME=24` 按当前最吃紧场景硬编，`FixedTimestep` 已接受
  `maxStepsPerFrame` 构造参数但没有场景/UI 接入。目前没有场景需要更高预算，出现前不安排实施。
