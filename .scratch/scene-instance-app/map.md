# 场景级实例物性应用：纯前端接入决策地图

ID: scene-instance-app
Labels: wayfinder:map
Status: open
Assignee: unassigned

## Destination

形成可交给后续实现的规格与决策地图：将给定完整场景与实例物性结果接入当前项目，明确纯前端准备、实例选择与转模拟、全局校正、场景容器，以及应用层与模拟/渲染内核的职责和验收标准。
终点是实现前需要的决策均已明确；本地图不承担正式功能实现。

## Notes

- 2026-09-09 用户明确简洁优先：容器尽量复用运行前后的编辑逻辑；运行时动态控制若能直接支持则保留，否则可舍弃，不为额外运动学能力扩大本轮范围。

- 2026-09-09 用户确认规划终点，并明确要求全部纯前端实现；其余范围按讨论建议执行。
- 输入是已有源场景与上游结果。网页内校验、转换、准备和缓存；必要时用 Worker。路径用于调查与识别数据来源，网页通过用户文件选择获得访问权。
- 初始所有实例仅渲染。点选显示实例信息，用户可将其加入共同模拟；新增允许暂停准备，保留已有物体位置与形变。仅渲染内容默认不参与碰撞。
- 2026-09-09 用户纠正范围：需要包住整个场景的六面封闭容器；撤回多个实心障碍盒的设定。容器编辑与运行时操作由[场景容器如何封闭、编辑并参与接触](issues/11-scene-container.md)明确。
- 模拟前先做坐标预设及手工旋转、整体尺度和平移校正，保持实例相对布局；容器与校正的具体交互待完整流程原型验证。开始模拟后再校正须回到准备阶段并重置模拟。
- 保存数据引用、全局变换、容器配置和物性覆盖值；不保存运行中的形变和速度。
- 应用分工及上游专属数据准备约束见[场景实例应用与模拟渲染内核如何分工](issues/03-app-boundary.md)；不预设通用插件框架。
- 上游脚本：`/home/liaowanjun/Projects/AnySplat/scripts/run_iggt_phys_pipeline.py`。
- 上游结果：`/home/liaowanjun/tmp/mx_runs/bench_504x336`。
- 源场景：`/home/liaowanjun/Datas/instascene_preprocessed_data/3dovs/bench`。
- 本机可读以上路径；以用户提供的路径为准，不替换为元数据中的历史 GPU 服务器路径。
- 每次继续先读本地图，按本地 tracker 查询首个未解决、无阻塞、未认领的子票；先认领后工作。HITL 票必须通过用户交流解决，每个工作会话最多解决一个非 research 票。
- 常用技能：[wayfinder](../../.agents/skills/wayfinder/SKILL.md)、[grilling](../../.agents/skills/grilling/SKILL.md)、[domain-modeling](../../.agents/skills/domain-modeling/SKILL.md)；讨论模块接口时用 [codebase-design](../../.agents/skills/codebase-design/SKILL.md)。按票类型使用 research / prototype。
- Tracker 使用 [Local Markdown 的 Wayfinding operations](../../.agents/skills/setup-matt-pocock-skills/issue-tracker-local.md)。子票用 ID / Parent / Labels / Status / Assignee / Blocked by 元数据；无原生依赖 UI，阻塞关系采用该文件约定。前沿按子票编号排序查询，不在本地图复制开放票清单。
- 研究在独立 `research/<name>` 分支留存，研究资产链接放回对应子票。结论只在子票 Answer 中记录，地图仅添加一句摘要和链接。
- 沿用仓库约束：新界面放 ui/，形变绑定走 deformation/bind.js；未来新增源码目录同步架构表与依赖表，依赖变更理由追加 DECISIONS.md。

## Decisions so far

<!-- 仅索引已解决的决策票；以上用户已确认的范围约束属于建图输入。 -->

- [上游数据的几何、实例对应与物性契约是什么](issues/01-upstream-data.md)：确认三件套、标签和 SI 字段契约；两轴 surfel 无已知厚度，身份校验、全局尺度与模拟体积仍需设计。
- [纯前端准备与本地恢复有哪些实际能力和限制](issues/02-browser-feasibility.md)：存在用户选文件、Worker 准备和浏览器存储路线；文件引用不等于持久权限，NPZ 需容器解码，整场景性能尚未实测。
- [场景实例应用与模拟渲染内核如何分工](issues/03-app-boundary.md)：各应用拥有随上游变化的专属数据准备，共用模拟与渲染内核；加入失败保留原场景，明确模块职责和后续接口扩展。

- [坐标预设与手工校正怎样得到一致的物理世界](issues/05-world-transform.md)：全场景等比例归一化并指定米制尺寸，绕中心校正；固定世界重力，重新校正恢复准备状态；原实心盒条款的适用范围已由容器票修正。

- [场景容器如何封闭、编辑并参与接触](issues/11-scene-container.md)：六面封闭容器统一使用平移、旋转、缩放 gizmo；局部空间处理接触，动态能力与流程细节交由原型验证，简洁优先。

- [两轴高斯表面怎样显示并成为可模拟的实体](issues/10-surface-to-volume.md)：显示接入 PlayCanvas 2DGS，模拟适配表面体素占据并复用既有封缝、填充与求解流程，具体问题据实际效果展开。

- [纯前端如何把源文件准备成可交互的实例场景](issues/04-import-contract.md)：三个文件槽导入并校验关联，完整场景先显示，物性缺失按实例补齐，体素与模拟资源按需准备。

## Not yet specified

- 首轮交互原型实际暴露的场景可用性问题，再据反馈展开体验取舍，不预先虚构操作难点或解决方案。
- 大场景实际运行中出现的体验与资源取舍，在测量或原型给出具体症状后展开；不在缺乏测量时承诺性能。

## Out of scope

- 在网页内启动或重做上游实例识别、物性推断流水线；首版消费已有结果。
- 应用后端、服务端计算、自动上传用户场景数据。
- [多个可旋转静态碰撞盒如何编辑并参与接触](issues/07-manual-colliders.md)：原需求是场景容器，多个实心障碍盒及运行时推动物体的运动学障碍物不服务当前终点，已关闭。
- 保存或恢复运行中的形变与速度。
- 正式实现、部署，以及为未知未来应用建设通用插件平台。
