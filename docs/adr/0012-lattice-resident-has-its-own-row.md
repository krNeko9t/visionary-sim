# 点阵的驻留区在依赖表里自成一行

`sim/discretize/lattice/` 在 `test/unit/architecture.test.js` 的 `ALLOWED` 里有自己的一行：可以依赖
`sim/discretize`、`deformation`、`assets`。它的可达范围与 `sim/discretize` 相同，只多了父目录本身
（中立的 `ProxyGeometry` typedef，以及第 2 步搬家之前还留在父目录里的点阵文件）。父目录依赖它不用
写：表的规则本来就允许一个区域依赖嵌套在它里面的目录。

它值得单独一行，是因为它是全仓库唯一可以说点阵的词的目录（`DISCRETISATION_RESIDENT`）。「只有一个
地方知道它是个点阵」要能被检查，这个地方能伸手到哪里就得明写，不能靠前缀默认继承。

## Considered Options

- **不加行，靠前缀归进 `sim/discretize`**。表的机制允许这样，结果也一样。否掉：`CLAUDE.md` 要求新增
  目录同时进依赖表；更要紧的是，代理几何重构第 3 步翻转依赖方向时（ADR-0007 的 Consequences），
  弹性约束搬进的是这个目录，那时它的可达范围要变，得有一行给它变。

## Consequences

- 第 3 步改 `ALLOWED` 时，这一行和 `sim/discretize` 那一行一起改。
- 驻留区也被列进 `REQUIRED`：删掉它是设计变更，不是重构。
