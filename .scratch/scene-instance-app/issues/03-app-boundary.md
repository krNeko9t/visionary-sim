# 场景实例应用与模拟渲染内核如何分工

ID: 03
Parent: [场景级实例物性应用：纯前端接入决策地图](../map.md)
Labels: wayfinder:grilling
Type: grilling
Mode: HITL
Status: claimed
Assignee: codex/root
Blocked by: 01, 02

## Question

为新应用明确领域对象、所有权与生命周期接口：

- 区分数据中的实例、模拟体、仅渲染内容和静态碰撞体；实例标识在选择、准备、模拟、配置恢复之间如何保持？
- 准备和交互状态由谁拥有；零模拟体时如何运行；现有 scene 配置与 main.js 装配如何归位，splats / mixed demo 如何复用同一内核？
- 哪些稳定能力由模拟、渲染和 deformation 的现有入口提供，哪些必须扩展？避免让应用或 UI 直接操作粒子缓冲、离散化细节。
- 纯前端文件读取、Worker、配置保存与 UI 分别落在哪里；不预先要求通用插件框架。

以具体调用和状态变化检验接口；结果给出可落实的模块职责与依赖变更提案，而不是在本票实施重构。

## Context pointers

- [现有场景契约](../../../src/scene/scenes.js)、[启动装配](../../../src/main.js)、[模拟公开入口](../../../src/sim/simulator.js)。
- [已确认领域术语](../../../CONTEXT.md)。

## Comments

- 2026-09-09：进入 Work through the map 阶段，认领本票；先与用户明确不同应用的变化范围，再讨论领域所有权和内核接口。尚未形成 resolution。
