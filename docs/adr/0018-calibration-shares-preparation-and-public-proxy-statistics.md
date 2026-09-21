# 离线校准复用场景准备与公开代理材料统计

扩展 ADR-0017 的离线依赖边界：校准工具需要真实的各精度代理节点，不能另造节点采样来冒充
运行时结果。`tools/` 可额外读取 `scene/alocasiaData.js`、`body/softBody.js`、
`sim/discretize/discretize.js`、`sim/staticPrescription.js` 与 `sim/state/materialCounts.js`；
护栏按完整路径限制这些入口，同时扫描静态和动态 import（排除 JSDoc 类型注释）。

场景与离线报告共用一次清洗/分类函数，状态与报告共用有材料节点计数函数。离线仅消费
`ProxyGeometry.dof`，不读取内部体积、不 import 点阵驻留区，也不构造 GPU 状态或执行求解。
这样更换代理实现仍只改变原有派发入口；复制离散化或直接依赖当前实现都会让校准结果与运行时漂移。
Node CLI 用 raw 文本加载钩子承接模块图中的 WGSL，与 Vite 的 `?raw` 约定相同；运行时代码
仍不可反向依赖 tools 或 Node 模块。报告只提供数值与逐点证据，不据总数自动选择或批准 r。
