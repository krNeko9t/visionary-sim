# 04 · 采样器搬出形变通道（条目 3）

Status: ready-for-agent
Type: task
Blocked by: 02

来源：[spec](../../proxy-geometry/spec.md)「第 4 步」；决定见 proxy-geometry 的 issue 11。

## What to build

形变采样器是点阵的实现，搬进驻留区，挂成 `ProxyGeometry.field()`；`simulator.field()` 改调它。
形变通道只持有契约：`DeformationField` typedef、`COVARIANCE_WGSL`，以及「`shader` 必须声明
`deformationAt(rest) -> Deformation`」。`parameters` 不透明，`deformedNode` 不进契约（I5）。

## Acceptance criteria

- [ ] `sample.js`、`sample.wgsl`、`corners.js` 与 `latticeField()` 住进驻留区，`field()` 由 `VoxelLattice` 提供
- [ ] `bind.js` 只剩契约；头部「只有一份实现，因为唯一的交集在这里」那段论证删掉
- [ ] `ARCHITECTURE.md` §二 `deformation/` 一行改成：持有契约，不是实现
- [ ] 一致性测试补 I5：已知仿射形变下，`deformationAt` 在静止节点处给出正确的位置与梯度
- [ ] 债单删 `sample.js`、`sample.wgsl`、`corners.js`、`bind.js`
- [ ] `sample.test.js`、`renderPaths.test.js`、一致性测试与全部 `npm test` 全绿
