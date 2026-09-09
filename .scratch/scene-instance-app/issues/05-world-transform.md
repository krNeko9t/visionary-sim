# 坐标预设与手工校正怎样得到一致的物理世界

ID: 05
Parent: [场景级实例物性应用：纯前端接入决策地图](../map.md)
Labels: wayfinder:grilling
Type: grilling
Mode: HITL
Status: open
Assignee: unassigned
Blocked by: 01, 03

## Question

决定源坐标到物理世界的变换契约：

- Blender / Nerfstudio / OpenCV / OpenGL 预设各自明确代表哪种轴、手性和相机或世界约定；X / Y / Z-up 与手工欧拉角如何组合？不能用软件名称推断每份数据必然相同。
- 整体尺度如何确认到物理长度单位，平移与旋转围绕哪个支点，重复点预设是替换还是累积？
- 高斯中心、椭球、显示方向相关外观、物理代理、重力、相机、碰撞盒与拾取采用什么一致的空间约定？
- 校正前后添加的碰撞盒如何保持对齐；开始模拟后回到准备阶段重新校正并重置模拟，具体恢复哪些状态？

给出明确的变换顺序、单位以及轴向样例的验收标准。场景各实例不能沿用逐物体归一化。

## Context pointers

- [现有捕获处理](../../../src/assets/splats/capture.js)、[坐标放置](../../../src/assets/splats/place.js)。
- [现有 splat 渲染接口](../../../src/render/splats.js) 使用世界空间数据，形变场接入后不能假设只转显示实体即可完成校正。
