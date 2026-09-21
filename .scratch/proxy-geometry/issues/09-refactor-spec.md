# 09 · 代理几何重构 spec

Status: resolved
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
- 更新地图：~~这张票关闭即地图关闭~~（本票解决时改为：10–13 全部关闭后地图才关闭）。地图关闭时要检查 **Not yet specified** 里还剩什么，该毕业的
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

## Answer

**spec 落在 [`spec.md`](../spec.md)，`ready-for-agent`。** 七步，每步一次提交、提交后全绿；完成标准
是 `DISCRETISATION_DEBT` 清空并删除。

定下来的：

1. **先接口后搬家。** 第 1 步原地让点阵满足中立接口、调用方全部改走接口；之后的搬家只剩改 import。
2. **一致性测试** `proxyGeometry.test.js`：按实现参数化，逐条检查接口条目与不变量，§五 加一行。
   第二个后端的准入条件就是它。
3. **`resolution` 换成 `elementSize`**（世界空间目标单元尺度，米）。「最长轴上几份」是点阵的实现
   细节：立方格只有一个 `h`，取最长轴是为了控制格数上限；而场景作者本来就在想毫米。
4. **接触模型是一个可换的选择，不是代理几何的规律。** 使用者追问「用球互相推开是不是本仓库的
   偷懒」时撞出来的：球并集是粒子类引擎的做法，网格类引擎用表面三角形。03 把「交出边界节点和
   半径、必须密封」写进了中立接口，是又一处把点阵的巧合当成定律。改为：接触用球单列一条 ADR
   （0008），接口条目 2 与 I2 注明是**球模型的准入条件**；换接触模型不在本图范围内。
5. **03 漏掉的一条依赖**：弹性约束搬进离散化后要看见 `compliance.js`，所以依赖方向是
   `sim/discretize → sim/constraints`，同时 `sim/constraints → sim/discretize` 删掉。03 只写了新增
   `sim/state`、`body`。`xpbdCouple` 是本构数学，拆出来留在 `sim/constraints/`。
6. **03 §九 的 ADR**：A → [ADR-0006](../../../docs/adr/0006-proxy-geometry-seam-buys-locality.md)
   （D 并进去当例证），B → [ADR-0007](../../../docs/adr/0007-discretisation-owns-elastic-not-contact.md)，
   C（依赖表）留给 spec 第 3 步与改表同一次提交。另加
   [ADR-0008](../../../docs/adr/0008-contact-is-a-union-of-node-spheres.md)。
7. **I4 收紧**：`wireframe().positions` 就是节点静止位置，收缩只给方向；I2 的密封检查靠它。

第 5 步（线框成为渲染路径）挂在 11 后面；其余步骤不等。地图不随本票关闭，10–13 关完才关。
