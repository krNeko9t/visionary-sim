# 02 · 点阵实现文件纯搬家

Status: ready-for-agent
Type: task
Blocked by: 01

来源：[spec](../../proxy-geometry/spec.md)「第 2 步」。

## What to build

点阵本体、Kuhn 剖分、体素化、点云体积四个文件搬进 `sim/discretize/lattice/`，只改 import 路径与
测试里的路径，不改逻辑。`mat3.js` 若不说点阵的词就留在原处。

## Acceptance criteria

- [ ] 四个文件住进驻留区，逻辑逐字未变（`git diff -M` 只见路径改动）
- [ ] 债单前四条 `moves` 删除
- [ ] 注释跟着代码走，不丢
- [ ] `npm test` 全绿
