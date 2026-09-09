# 多个可旋转静态碰撞盒如何编辑并参与接触

ID: 07
Parent: [场景级实例物性应用：纯前端接入决策地图](../map.md)
Labels: wayfinder:grilling
Type: grilling
Mode: HITL
Status: open
Assignee: unassigned
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
