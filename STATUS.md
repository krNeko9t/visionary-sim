# 当下状态

## 当前里程碑：原型支持多实例共同模拟

- [x] M1 · `sim/` 具备保状态追加：节点状态快照/迁移，构造期资源改为可重建的 arena，`prepareAppend/commit/cancel`。
- [x] M2 · 场景与界面按会话组织：一个 Simulator 承载多个成员，加入第二个实例时旧体位置、形变、速度不丢，旧视图改绑到新缓冲。
- [x] M3 · 单元测试覆盖迁移与追加生命周期，文档与决策记录补齐。

## 当前里程碑：原型可查看模拟体

- [x] L1 · `sim/debug/latticeView.js` 接受求解所在的刚体坐标系，可画在容器帧里。
- [x] L2 · 会话按需构建/销毁格线视图，追加换缓冲时随成员重绑一起重建。
- [x] L3 · 界面加三态开关（关／叠加／独显）与每个成员的格数、格距读数。
- [ ] L4 · 浏览器内实测：格线是否与高斯对齐、独显下是否真的看得见密度。

## 交接入口

- [决策地图](.scratch/scene-instance-app/map.md)已收束，终点是实现前决策。
- [实现交接](.scratch/scene-instance-app/handoff.md)列出决策来源与后续验收。
- 原型归档分支：`prototype/scene-instance-app`，运行 `npm run prototype:bench`。
- 追加契约见[06 票](.scratch/scene-instance-app/issues/06-promotion-lifecycle.md#answer)：加入期间冻结，不得用重建抹掉旧状态。
- 追加已实现并有单元测试；浏览器内多体实际效果、跨物体接触与性能未实测。
- 保存恢复仍未做。
- 模拟体开关只为看清离散化，不改变求解；线框与高斯的遮挡关系未在浏览器里确认。
- 不继续预算调优或 GPU 余量研究。
