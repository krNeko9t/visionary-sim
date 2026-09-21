# 03 · 弹性约束由离散化交出（条目 9）

Status: ready-for-agent
Type: task
Blocked by: 02

来源：[spec](../../proxy-geometry/spec.md)「第 3 步」「依赖表」；理由见 ADR-0007。

## What to build

弹性约束从 `sim/constraints/` 搬进点阵驻留区，对外是模块级
`elasticConstraints(device, particles, proxies, materials) → Constraint[]`，场景里所有 `VoxelLattice`
合成一个今天的 `ElasticCells`；模拟器改调它。约束一侧从此看不见离散化，依赖方向翻转。

## Acceptance criteria

- [ ] `elasticCells.js`、`cells.wgsl`、`project.wgsl` 住进驻留区，模拟器只调 `elasticConstraints()`
- [ ] 四面体静止体积搬进驻留区；`elementCompliance` 改收单元静止体积（一个数），留在 `sim/constraints/`
- [ ] `xpbdCouple`（偏量与体积两条约束的 2×2 联立）拆成 `sim/constraints/wgsl/` 下独立文件，
      驻留区拼接它；`body/material.js` 的注释改指这个新文件
- [ ] `ALLOWED` 按 spec「依赖表」改（`sim/discretize` 加 `sim/constraints`、`body`；`sim/constraints`
      删 `sim/discretize`），文件顶部规则解释同步改写；同一提交里新写一条 ADR 记依赖方向翻转的理由
- [ ] `ARCHITECTURE.md` §二 `sim/discretize/` 与 `sim/constraints/` 两行改措辞
- [ ] 债单删 `elasticCells.js`、`cells.wgsl`、`project.wgsl`、`compliance.js`
- [ ] `elastic.test.js`、`compliance.test.js`、`architecture.test.js` 与全部 `npm test` 全绿
