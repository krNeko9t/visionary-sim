# 只有 `sim/discretize/` 可以 import 进点阵的驻留区

`test/unit/architecture.test.js` 的离散化词表在扫描之前把 import 路径抹掉；进入
`sim/discretize/lattice/` 的边改由一条 import 规则检查：只有驻留区自己和 `sim/discretize/` 可以
import 进去。

债单清空之后，`sim/discretize/discretize.js` 是唯一一个不在驻留区、却必须知道点阵住在哪的文件：它
选用哪一种代理几何，就得 import 那一种。它的 import 路径里有 `lattice`，词表会永远把它判红。路径说的
是「模块住在哪」，不是「模块是什么」；该管这条边的是 import 规则，而依赖表（`ALLOWED`）按前缀放行，
`sim`、`ui` 都能伸进驻留区，所以需要单独一条。

## Considered Options

- **给 `discretize.js` 留一条豁免**。否掉：spec 的完成标准是词表测试不带豁免表；豁免一个文件，等于
  「换掉点阵只动一个目录」这句话又需要有人记得去改。
- **把 `discretize.js` 搬进驻留区**。否掉：它是选择点阵的地方，不是点阵本身；第二种代理几何接进来时
  它要同时认识两种，放在其中一种的目录里就错了。
- **在 `ALLOWED` 里把 `sim/discretize/lattice` 从别的区域的可达范围里扣掉**。表的机制是前缀放行，没有
  「除了」；为一个目录给表加一种语义，不如一条专门的测试说得清楚。

## Consequences

- `discretize.js` 的绑定名必须中立：它能写路径，不能写 `VoxelLattice`、`voxelize`——那些是点阵的知识，
  搬进了 `lattice/voxelLattice.js` 的 `discretizeBody()`。
- JSDoc 里的 `import('./lattice/…')` 类型标注不算 import 语句，词表照样扫：类型标注是知识边。
