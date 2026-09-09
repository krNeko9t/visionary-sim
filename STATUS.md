# 当下状态

## 当前里程碑：场景实例应用任务拆分（2026-09-09）

- [x] M1 · 读取完整规格、to-tickets 及本地 tracker 约定，核对现有入口与原型。
- [x] M2 · 拟定 9 个可验收任务及必要依赖，测试随各票交付。
- [x] M3 · 用户确认拆分；9 张实施票逐票发布为 ready-for-agent。
- [x] M4 · 链接有效、依赖无环、覆盖 38 条用户故事；11 项文档/架构检查通过。
- [x] M5 · 文档移至 ft_upstream，分支检查通过；后续正式实现沿此分支推进。

## 交接入口

- [首张实施票](.scratch/scene-instance-app-implementation/issues/01-app-entry.md)无阻塞，可开始；其余按各票 Blocked by 推进。
- [原规格](.scratch/scene-instance-app/spec.md)保持原文与状态；本轮按 to-tickets 约定不修改父项。
- [决策地图](.scratch/scene-instance-app/map.md)已收束，终点是实现前决策。
- [实现交接](.scratch/scene-instance-app/handoff.md)列出决策来源与后续验收。
- 原型归档分支：`prototype/scene-instance-app`，运行 `npm run prototype:bench`。
- 正式实现尚未完成；多实例追加、保存恢复及完整浏览器验收留给后续实施。
- 不继续预算调优或 GPU 余量研究。
