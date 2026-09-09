# 场景级实例物性应用：实现交接

决策地图已收束；本文件是实现与验收索引，不复制各票的完整规则。正式实现尚未完成。

## 决策入口

| 实现范围 | 唯一决策来源 |
|---|---|
| 原始数据与实例物性 | [上游数据契约](issues/01-upstream-data.md#answer) |
| 浏览器能力与文件权限 | [纯前端准备与本地恢复](issues/02-browser-feasibility.md#answer) |
| 模块分工与接口 | [应用与模拟渲染内核分工](issues/03-app-boundary.md#answer) |
| 导入、校验、按需准备 | [纯前端导入契约](issues/04-import-contract.md#answer) |
| 世界坐标与米制尺度 | [坐标预设与手工校正](issues/05-world-transform.md#answer) |
| 共同模拟与失败保留 | [实例加入生命周期](issues/06-promotion-lifecycle.md#answer) |
| 本地保存与重开 | [准备配置与派生缓存](issues/08-preparation-persistence.md#answer) |
| 最终交互基线与验证边界 | [完整流程原型结论](issues/09-interaction-prototype.md#answer) |
| 两轴高斯与模拟实体 | [表面显示与体积构造](issues/10-surface-to-volume.md#answer) |
| 六面容器与接触 | [场景容器](issues/11-scene-container.md#answer)，首版运行范围以原型结论收束 |

## 原型资产

- 分支：`prototype/scene-instance-app`；运行 `npm run prototype:bench`。
- 页面：`http://127.0.0.1:5174/src/ui/bench.prototype.html?variant=A`。
- 默认源文件为地图给定的本机 bench 数据，开发服务器仅提供固定文件字节；正式文件选择与处理保持纯前端。
- 已展示真实场景、选择、校正、容器编辑和单实例模拟。原型中的内核试验须在正式实现时评估，不直接当作完成的产品合入。

## 后续实施与验收

- [ ] 按模块分工接入正式入口、文件关联校验与准备状态，验证错误文件及缺失物性路径。
- [ ] 实现共同模拟追加，验证已有物体状态保留、取消和失败回滚；不得用单实例重建替代。
- [ ] 验证世界校正、初始容器范围和越界提示、六面及旋转容器接触、抓取边界、重新校正重置。
- [ ] 按保存契约实现真实保存重开、源文件重新关联和无缓存恢复。
- [ ] 在实际浏览器上验收遮挡与 floater 拾取、相机/gizmo/抓取事件归属及完整流程；记录实际环境和结果。

以上是后续实现的检查清单，不是本轮待继续解决的决策票。预算调优、GPU 余量研究、性能控制面板不在本地图范围内。
