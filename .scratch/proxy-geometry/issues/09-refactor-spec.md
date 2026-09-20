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
