# 离散化依赖约束，约束不再依赖离散化

`test/unit/architecture.test.js` 的 `ALLOWED` 里，`sim/discretize` 与 `sim/discretize/lattice` 可以依赖
`sim/state`、`sim/constraints`、`body`；`sim/constraints` 只剩 `sim/state`、`body`，不再能依赖
`sim/discretize`。两者之间的边从「约束看离散化」翻成「离散化看约束」。

起因是 ADR-0007：弹性约束由离散化自己造（`elasticConstraints()`，点阵的实现是
`sim/discretize/lattice/elasticCells.js`）。造它要三样东西：节点（`sim/state` 的 `Particles` 与
`STATE_WGSL`）、求解器的公式（`sim/constraints/compliance.js` 的顺服量、
`sim/constraints/wgsl/xpbdCouple.wgsl` 的 2×2 联立）、材料（`body`）。公式留在 `sim/constraints/`，
因为它们是 XPBD 与本构模型的数学，不是点阵的：换掉点阵它们不动，换掉求解器它们才动。

反方向的边随之失去用处：接触读的是 `ProxyGeometry` 交给它的 `contactSurface()`，弹性已经搬走，
`sim/constraints/` 里没有文件还需要 import `sim/discretize`。留着这条许可，下一次顺手的伸手就会
让两个目录互相依赖。

`sim/solver` 仍然不在离散化的可达范围里：离散化交出的是约束，由 `simulator.js` 交给步进器，它
看不见谁来跑它们。

## Considered Options

- **公式跟着弹性约束一起搬进驻留区**，依赖表不动。否掉：顺服量与 `xpbdCouple` 说的是「一个单元、
  两条约束、一个静止体积」，与单元怎么来无关；搬进点阵目录，第二个离散化就得再抄一份，或者反过来
  去 import 点阵目录。
- **保留 `sim/constraints` → `sim/discretize`**，两个方向都许可。否掉：表里没有环的检查只看文件级，
  目录级的双向许可会让「谁是谁的上游」这句话失去意义，这张表的用处就是把它说清楚。

## Consequences

- 顺服量的入参是单元静止体积（一个数），不是离散化的对象：`sim/constraints/` 由此不必知道单元的
  形状。
- 新的一种约束若也是某种离散化的知识（单元、批次、静止形状），它住进那个离散化的目录；若跨物体
  耦合，它住在 `sim/constraints/`，只收离散化交出的中立数据（ADR-0007 的判据）。
