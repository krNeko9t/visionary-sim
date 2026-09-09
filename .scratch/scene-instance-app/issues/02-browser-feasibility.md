# 纯前端准备与本地恢复有哪些实际能力和限制

ID: 02
Parent: [场景级实例物性应用：纯前端接入决策地图](../map.md)
Labels: wayfinder:research
Type: research
Mode: AFK
Status: resolved
Assignee: codex/scene_browser_research
Blocked by: none

## Question

只用官方文档、规范、已安装源码调查纯前端可行性：

- 浏览器如何由用户选择源场景与上游结果文件；文件选择、目录选择、文件句柄各自的兼容性与授权边界。不能凭绝对路径直接读磁盘。
- NPZ / NPY、PLY、JSON 的解码、Worker 调度、ArrayBuffer 转移与取消能采取哪些可验证路线？现有依赖可复用什么？
- IndexedDB / OPFS / 文件导出对于准备配置和派生缓存的适用性、配额、淘汰、重开后重新选择源文件的限制。
- WebGPU、内存限制及百万高斯处理的已知成本；将静态估计与实测严格分开，不承诺未测过的设备性能。
- 全流程能否保持用户数据不上传，不运行应用后端或上游 Python？静态网页托管与服务端计算要明确区分。

给出支持条件、证据及仍需用户决定的产品取舍；不锁定浏览器支持范围或新增依赖。

## Research context

- Branch: `research/scene-browser-preparation`
- Worktree: `/tmp/scene-browser-preparation`
- Commit: `cb4fec5`
- Asset: [纯前端场景准备与本地恢复：能力调查](../browser-research.md)；原报告保存在研究分支根目录 `scene-browser-research.md`，本地归档调整了源码相对链接。

## Answer

2026-09-09 · codex/scene_browser_research 完成官方资料与本地源码调查。完整引用和能力限制见研究资产。

- 存在纯前端路线：用户选择 File，Worker 解析和准备，ArrayBuffer 转移结果，IndexedDB / OPFS 保存配置或派生数据；该结论来自 API 能力及代码结构，尚未实测本场景性能或显示兼容性。
- 文件路径不是读取权限。普通文件选择可作为基础路线；增强文件句柄须特性检测，持久化句柄仍可能需要重新授权或重新选择。静态网页托管不等于应用后台计算。
- NPZ 需要 ZIP 容器和 NPY 数组解析；原生解压流不负责 ZIP 容器。现有纯数组 PLY / cloud 函数可作复用候选，但迁入 Worker 无法解决三轴加载契约与两轴输入的差异。
- 浏览器缓存有 origin、配额和持久性限制，配置恢复与恢复源文件访问应分开。ArrayBuffer 转移减少线程间复制，不消除算法与渲染自身的分配。
- 未选择浏览器基线、解码依赖或存储方案，未安装依赖、上传数据或运行后端。后续票据此决定准备与恢复契约，再通过原型或测量确定资源预算。
