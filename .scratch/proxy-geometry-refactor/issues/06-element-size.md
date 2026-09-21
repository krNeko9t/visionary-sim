# 06 · 细度的单位：`resolution` → `elementSize`

Status: ready-for-agent
Type: task
Blocked by: 02

来源：[spec](../../proxy-geometry/spec.md)「作者侧的细度」「第 6 步」。

## What to build

作者用世界空间的目标单元尺度（米，默认 `0.01`）描述细度，而不是「最长轴上几个格」。点阵直接拿它
当 `h`：`dims = ceil(extent / elementSize) + 2 * padding`。它是作者的**要求**，与条目 6 实测的
`spacing` 是两回事，不合并、不借名。

## Acceptance criteria

- [ ] 软体、工厂、体素化的网格尺寸函数、点云体积、全部场景（tank、football、splats、mixed）及相关测试改用 `elementSize`
- [ ] 场景值二选一：要逐位保持行为写成 `0.16 / 16` 形式，否则直接写注释里的毫米数；同一场景内统一
- [ ] 场景注释改说毫米，不再说「份」「格」；tank 的「全场共用一个尺度，CFL 因此一致」论证保留，改用 `elementSize` 表述
- [ ] `body/material.js` 的稳定性论证改按单元尺度 / `cflLength` 说
- [ ] 债单删 `scene/tank.js`、`scene/splats.js`、`scene/football.js`、`body/material.js`
- [ ] `timestep.test.js`、`voxelize.test.js`、`cloudVolume.test.js`、`simulatorTiming.test.js` 与全部 `npm test` 全绿
