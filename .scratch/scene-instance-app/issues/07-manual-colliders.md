# 多个可旋转静态碰撞盒如何编辑并参与接触

ID: 07
Parent: [场景级实例物性应用：纯前端接入决策地图](../map.md)
Labels: wayfinder:grilling
Type: grilling
Mode: HITL
Status: resolved
Assignee: codex/root
Blocked by: 03, 05

## Question

已确认需要多个可移动、旋转、缩放的静态实心盒，用来近似地面、墙和桌面。决定：

- 盒的表示、选择与编辑、可见性和所属坐标；盒是障碍物，不是当前水缸的内部六面边界。
- 它与模拟体如何产生接触，摩擦和接触厚度如何定义；保留或替代现有水缸边界的范围是什么？
- 当前接触粗筛依赖 tank 范围，任意场景与盒的接触需要哪种内核接口及范围策略？
- 初始相交、模拟过程中修改盒、极薄盒或超出范围的行为如何规定？

不要求从 Gaussian 或 floater 自动拟合碰撞体。用地面加倾斜盒的场景说明可验收的结果。

## Context pointers

- [当前物体接触](../../../src/sim/constraints/bodyContact.js)、[粗筛网格](../../../src/sim/constraints/broadphase.js)。
- [现有抓取](../../../src/ui/grab.js) 也使用 tank 范围限制，需要与相机和模拟范围一起检查。

## Comments

- 2026-09-09 用户要求先区分容器六面边界与实心障碍，并询问运行时移动碰撞边界是否可由当前仓库直接支持；尚未回答首轮选项。核对 `sim/solver/stepper.js:81` 与 `sim/simulator.js:303`：tank 范围每帧传入，因此改变轴对齐边界可利用已有投影推开节点；但现有摩擦按静止表面计算，且没有旋转有限盒及其运动速度契约。此前“仅准备阶段编辑”是建议，不是不可实现的限制；运行时控制碰撞体仍待用户取舍。

- 2026-09-09：codex/root 认领，使用 grilling 与 domain-modeling，并委派只读检查接触和 tank 依赖。第一轮待用户决定：盒是否仅在准备阶段编辑、是否采用视口控件加数值输入、手工盒之外是否允许自由掉落或另设可选无限地面。建议尚未确认，本票保持 claimed。
- 2026-09-09 只读核对：`sim/solver/wgsl/finalize.wgsl:54` 的 tank 接触是底面加四侧的无限半空间，无顶；处理节点中心且没有接触厚度，摩擦取软体值。`sim/constraints/bodyContact.js:64` 的软体接触只用表面节点，半径为 h/2。`sim/constraints/broadphase.js:78` 将越界节点夹到边缘桶，粗筛范围不是物理墙。`ui/grab.js:104` 将抓取目标限制在 tank ±0.02m。后续需区分静态盒、粗筛范围和抓取范围；上述事实不构成产品行为决策。

## Scope disposition

2026-09-09 · 用户澄清原始需求是包住整个场景的容器，运动学障碍物是无助于当前终点的额外功能，移出范围。本票以范围纠正关闭，不计入 Decisions so far；此前实心盒提案不再作为本轮需求。容器的未决问题转至[场景容器如何封闭、编辑并参与接触](11-scene-container.md)。
