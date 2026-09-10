# 当下状态

## 当前里程碑：场景实例应用实施（2026-09-09—10）

- [x] M1 · 九票逐票派独立 gpt-5.6-sol medium subagent，依 implement 流程实施；起始提交 6c9f5f20109fb2fa4dd9da06743089b043d7e168。
- [x] M2 · 01—04 生产接线与非 GPU 回归：应用入口、真实三件套导入、实例物性、全局校正和容器编辑。
- [x] M3 · 05—07 生产接线与非 GPU 回归：按需模拟、共享状态追加、返回准备、名单整批重启、独立抓取开关。
- [x] M4 · 08—09 生产接线与非 GPU 回归：完整字节指纹、原子配置恢复、JSON 和手动本地保存。
- [x] M5 · 真实右侧浏览器文件选择、Worker 取消重试；开发 Worker 与生产构建 Worker 均完成 bench 导入和 ID1 CPU 模拟准备。
- [x] M6 · 最终双轴审计返工、全套 66 文件 / 449 项测试、生产构建、清理与本地提交。
- [ ] M7 · WebGPU 成功启动及既有演示、完整显示/拾取/着色/gizmo/接触/形变/抓取、真实追加状态和返回准备验收。
- [ ] M8 · 正式应用 JSON 下载落盘、关闭重开、本地记录及真实源关联后共同模拟的完整浏览器验收。

## 当前事实与未验范围

- 用户授权 AFK 实现、测试、返工、浏览器操作和本地 git commit，无需逐票确认。
- 已确认并修正启动错误归类：PlayCanvas 工厂吞掉初始化异常后回退 WebGL2，项目随后误报浏览器能力。现直接初始化 WebGPU，保留真实原因与普通引擎异常。
- 当前右侧浏览器为 Chrome/152.0.0.0、Linux x86_64、secure context；独立于项目的原生 WebGPU adapter 请求各参数仍返回 null。尚未定位为何未提供 adapter，不能将此描述为硬件不支持，也未成功启动 GPU。
- 真实 bench 为 1,045,236 高斯、9 正 ID、39,528 未追踪；原始行索引及45项SH均保留，实际浏览器 Worker 与完整字节指纹已验证。
- 多轮审计已修复 ZIP64、异步清理、指针归属、Float32 零尺度、Worker 生产打包、发布期间物性竞态、旧质量指标和缺少追加/抓取按钮。source GPU 候选异步验证、同设备作用域串行化及可等待销毁已完成回归。
- [实施票目录](.scratch/scene-instance-app-implementation/issues/)保留真实 GPU 条目未勾选，未以 CPU 或替身结果关闭全部票。
- 详细依据：[规格](.scratch/scene-instance-app/spec.md)、[交接](.scratch/scene-instance-app/handoff.md)、[主验收记录](.scratch/scene-instance-app-implementation/acceptance.md)。
