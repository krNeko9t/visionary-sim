# 09 · 代理几何重构 spec

Status: open
Type: grilling
Blocked by: 03, 05, 06

## Question

把前面几张票的结论合成一份可以交出去执行的 spec——本图的交付物，也是这段路的终点。

内容来自：03 的类型草案（中立类型的字段与签名）、02 的清单（哪些位置要动）、05 修正后的
`ARCHITECTURE.md`§四（改动要落在哪个根下面）、06 的护栏（改完之后由谁守着）。

spec 要回答：

- **改什么**：`discretizeBody()` 的返回类型、`simulator.js` 那 31 处、`deformation/bind.js` 的
  采样器签名、`sim/constraints/` 站哪一侧（由 03 决定）。
- **顺序**：哪一步单独落盘之后仓库仍然是绿的。这决定了它能不能被切成多次提交。
- **缝架在哪**：每一步由哪个测试兑现。`ARCHITECTURE.md`§五那张表有没有新增行。
- **什么不做**：不实现第二个离散化后端（那是这份 spec 的下游，不是它的内容）。

### 收尾

- spec 落在 `.scratch/proxy-geometry/spec.md`，triage 标签按 `docs/agents/triage-labels.md`。
- 更新地图：这张票关闭即地图关闭。地图关闭时要检查 **Not yet specified** 里还剩什么，该毕业的
  毕业成新票，该作废的说明作废。
- 锚定机制那张图这时才可以开——它的前置条件（词汇、类型边界、代价声明）到此全部就位。

## Comments

### 05 的结论对本票的影响（2026-09-21）

- 「改动要落在 §四 哪个根下面」这个输入没有了：4.2 已转成 [ADR-0005](../../../docs/adr/0005-voxel-lattice-proxy-geometry.md)，
  代价声明被删。spec **不需要**在收尾时改写 `ARCHITECTURE.md` 的代价栏，重构落地的验收就是
  06 的词表测试转绿。
- 重构把点阵细节搬进 `sim/discretize/lattice/` 时，**注释跟着代码走**：02 那九条假定今天都在
  源码注释里，搬家时不许把它们丢了，也不许把它们抄回任何文档。

### 06 交来的验收清单（2026-09-21）

`test/unit/architecture.test.js` 的 `DISCRETISATION_DEBT` 列出了今天 `sim/discretize/lattice/`
之外仍在说点阵的 33 个文件，每条带一句「由哪一步还」。**spec 的完成标准可以直接写成「这张表
为空、常量删掉」**；有一条测试保证表里不会留着已经还清的条目，所以每一步的进度都能机器读出。

比 03 的搬家清单**多出来**、spec 要单独排的：

- **`resolution` 的单位**：`scene/{tank,splats,football}.js` 按「N mm cells」调参，
  `body/material.js` 的稳定性论证按单元说。
- **下游的散文**：`assets/{shapes,tessellate}.js`、`assets/splats/{clean,measure}.js`、
  `deformation/covariance.js` 用点阵解释自己。没有接口条目要它们改，只是说的话会不再成立。
- **`cell` 的中立用法**：`broadphase.js` 的 hash grid 与 `timestep.js` 的 CFL。还完真债后若只剩
  这种误伤，在那个文件里改名（grid cell → bucket），不要把它留在债单上。
- `render/` 那条词表测试的注释里 `sim/debug/` 的豁免理由，随 `sim/debug/` 消失一起删。
