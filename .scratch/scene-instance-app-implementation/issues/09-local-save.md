# 09: 浏览器本地保存与重开

**Parent:** [场景级实例物性应用规格](../../scene-instance-app/spec.md)

**What to build:** 用户手动将准备配置保存到浏览器，关闭后重开、重新关联源文件即可恢复；本地保存失败或记录被清理时，有明确反馈及可用的 JSON 导出恢复路线。

**Blocked by:** [08：导出配置并重新关联源文件恢复](08-portable-configuration.md)

**Status:** implemented-awaiting-webgpu-acceptance

**Assignee:** Sartre · gpt-5.6-sol medium（主 agent 审计、验收、提交）

- [x] 手动本地保存复用已验证配置格式，保存最新校正、容器、物性及参与名单；不自动保存、不保存大源文件或运行形变和速度。
- [ ] 关闭页面后重开能读取本地记录，缺少源访问权则提示选择三个槽位；匹配校验通过恢复准备状态，不自动运行。
- [x] 保存成功提示仅在存储完成后出现；配额、权限或存储失败明确报告，内存编辑保留并可导出 JSON。
- [x] 浏览器本地记录被清理后可通过此前导出配置及源文件恢复；无副本不承诺找回，文件引用不描述成永久权限或备份。
- [x] 仅使用可重建会话缓存，重开不依赖持久体素等派生资源；无缓存重建和存储失败不破坏当前场景。
- [ ] 应用边界使用受控存储错误验证反馈与保留；真实浏览器完成保存、关闭重开、重选源、恢复名单、开始共同模拟和记录清理后 JSON 恢复，不能以存储替身冒充验收。
- [ ] 记录浏览器版本、系统、GPU/适配器、源数据、操作和结果；汇总本票完整重开流程中的失败，修复后重验，不延伸为预算或 GPU 余量研究。

## Context

- 对应规格 User Stories：32、35–37；Implementation Decisions：19–21。规格完整契约及最终修订仍适用。
- 测试采用应用公开操作和可观察状态，复用既有内核测试；真实显示、接触、抓取及持久化行为在实际浏览器验收，不以构建或测试替身代替。
- 决策依据与原型验证边界见[实现交接](../../scene-instance-app/handoff.md)。原型是参考，未实现的功能及未完成验证须在本票范围内兑现。

## Approval

- 2026-09-09：用户确认 9 票拆分、粒度及阻塞边，按本地 tracker 约定发布。

## Comments

- 2026-09-09：独立基础模块 ready。新增 `src/app/localPreparation.js`，公开
  `createLocalPreparationStore({ storage, validate, key })`、`save(config)`、`read()`；默认复用
  08 的 `validatePreparationConfig`，测试仍可在浏览器存储边界注入 validator。仅写入 validator
  返回的一条轻量 JSON，写后精确回读才报告成功；配额、权限、静默拒写、读取失败、记录损坏和
  无记录均返回受控状态，失败提示保留当前编辑并提供 JSON 导出/导入路线。读取成功明确要求重选
  三个源文件并设置 `autoStart: false`。本票单测 8/8、连同 08 配置测试 14/14、production build
  通过；全套 321 项中 319 项通过，剩余失败来自并行票尚未落盘的 migration 模块及
  `FixedTimestep.clone/restore`。production 应用/UI 重开接线仍等待 05/06/07/08 与 session ready。

- 2026-09-10：本票独立 agent 的生产实现已汇合，主 agent 完成多轮审计和返工。勾选表示实现及对应非 GPU 边界验证完成；要求真实 GPU/完整浏览器流程的条目仍未勾选，整票未关闭。当前右侧页面的独立原生 requestAdapter 仍返回 null，不将启动误报修复等同 GPU 启动成功。各项证据、返工及未验范围见[主验收记录](../acceptance.md)。
