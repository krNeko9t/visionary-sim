# 07 · 下游措辞，清空债单

Status: ready-for-agent
Type: task
Blocked by: 03, 04, 05, 06

来源：[spec](../../proxy-geometry/spec.md)「第 7 步」；抓取链的词见 `CONTEXT.md` 与 proxy-geometry 的 issue 12。

## What to build

点阵之外再没有文件用点阵解释自己，债单不复存在——这是整份 spec 的完成标准。

## Acceptance criteria

- [ ] assets（形状、三角化、splat 清洗与测量）与协方差的注释改说「代理几何」「单元尺度」
- [ ] `scene/mixed.js` 头部改说「接触发生在代理几何上，与画出来的是什么无关」，不再自称 §三 的验收
- [ ] 宽相、时间步里剩下的中性 `cell` 就地改名（grid cell → bucket，cell crossing → element crossing）
- [ ] 抓取链改用 `CONTEXT.md` 的词：`handle` 系列 → `grabTarget` 系列（模拟器、运动学驱动、drive WGSL）；
      `Grip` → `GrippedPart`；`DEFAULT_GRAB_RADIUS` 改成说握持物半径的名字；「handle anchor」拆成锚点与抓取目标
- [ ] 删除 `DISCRETISATION_DEBT` 与引用它的两处；「没有已还清的债」测试删除，词表测试不带豁免表
- [ ] `npm test` 全绿
