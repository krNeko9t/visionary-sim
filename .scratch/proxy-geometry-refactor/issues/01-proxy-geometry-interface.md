# 01 · 中立接口 `ProxyGeometry`，点阵原地满足

Status: ready-for-agent
Type: task
Blocked by: None (can start immediately)

来源：[spec](../../proxy-geometry/spec.md)「第 1 步」。执行前先读 spec 的「执行前必读」「接口」「每一步都要做的」三节。

## What to build

模拟体的离散化对外只交出一个中立的 `ProxyGeometry`；今天的 `Lattice` 被包进 `VoxelLattice`，
满足条目 1、2、4–8 与不变量 I1–I4、I6。所有在点阵之外直接伸手读 `Lattice` 字段的调用方
（模拟器、抓取、接触、宽相、顺服量的波速比、时间步、面板、入口日志、线框调试视图）改走接口。
行为不变：场景跑起来与重构前一样。

`ElasticCells` 这一步仍然接收 `VoxelLattice` 内部的裸 `Lattice`，03 再动。

## Acceptance criteria

- [ ] `ProxyGeometry` typedef 在 `sim/discretize/`（驻留区之外），条目 1–8 与六条不变量写成 JSDoc；
      I2 注释按「球接触模型（ADR-0008）的准入条件」的口径写，I4 注释写明一致性测试依赖 `wireframe()`
- [ ] `VoxelLattice` 住在 `sim/discretize/lattice/`；线框几何从调试视图搬进来，交节点静止位置（I4）；
      `relumpMasses()` 变成 `setDensity()`；接触密封半径的常量连同论证搬进来
- [ ] `discretizeBody()` 返回 `ProxyGeometry`；`coarsestCell`/`finestCell` 改由各物体 `spacing` 取极值；
      `stats().perBody` 的 `gamma` 直接由材料算
- [ ] 线框调试视图改为消费 `wireframe()`
- [ ] 新的一致性测试按实现参数化（今天只有 `VoxelLattice`，两三个小形状），逐条检查条目 1、2、4–8
      的形状与 I1–I4、I6；I2 用 `wireframe()` 的线段检查，I3 用一趟暴力最近邻实测
- [ ] `ARCHITECTURE.md` §二加 `sim/discretize/lattice/` 一行；§四护栏表加「代理几何的接口不变量
      （含球接触的密封条件）｜一致性测试文件」一行
- [ ] 接触相关 WGSL（`collide.wgsl`、`contacts.wgsl`、`sort.wgsl`）里用点阵角点/节点论证桶容量、
      着色、接触近似的注释，改成按接触球与 `spacing.min` 论证（spec 没分配这三条债，归本票）
- [ ] 删掉本票还清的债单条目（以「没有已还清的债」那条测试为准；`compliance.js` 要到 03 才还清）；
      债单只减不增；承重假定的注释跟着代码走
- [ ] `npm test` 全绿
