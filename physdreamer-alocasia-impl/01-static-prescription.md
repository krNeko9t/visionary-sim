# 01: 让模拟体声明静态区域，并在完整状态生命周期中保持固定

**What to build:** 作者可为模拟体声明通用的静止世界空间区域。模拟构造时，该区域内节点从初态起不参与位置求解，同时继续作为材料和接触表面存在；未声明的物体保持现状。

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] 遵守 ADR-0003/0016：物体只声明区域判据，不接收节点索引，不认识 GPU、点阵或数据集；模拟侧对代理静止位置求集合，并负责多体局部到共享索引转换。纯位置与模拟构造测试不依赖真实资产或 GPU。
- [x] 状态独立保存静态集合与运动学集合，GPU 逆质量由材料逆质量与二者合成，第一份上传即已生效。材料逆质量和代理中零代表无材料的契约不变，不新增求解器派发约束或运行时锁定/解锁功能。
- [x] 松手只释放运动学规定；改密度重新合成质量；重置恢复静止位置与零速度且保持静态规定；重新构造以新节点静止位置重求集合，不复用旧索引。
- [x] 核心允许空/全静态集合。每体可报告有材料、静态有材料、可动有材料节点数量；无材料节点不计入固定材料统计。统计不泄漏代理实现细节。
- [x] 静态接触节点仍存在于接触表面，合成双体案例验证静态侧不移动、另一物体仍获得接触响应；不能仅以 GPU 逆质量为零替代接触验证。
- [x] 提供合成多体/非零偏移、空/全静态、静态与运动学重叠、密度/松手/重置/重建的行为证据。相关测试及架构、文档护栏通过，记录执行命令与结果；真实 GPU 位置验证由 08 完成。

## 实施边界

依据原 spec「静态规定机制」「合成数据与状态契约」。本票交付静态支撑与状态生命周期；02 完成两种交互驱动的资格过滤，不能在此票完成时宣称交互验收通过。必要结构变化同步当前架构与护栏，依赖规则变化记录 ADR，保留点阵知识边界。


## Comments

### 2026-09-21 · implementation complete, awaiting independent review

Status 保持 `ready-for-agent`，待独立 reviewer 使用 code-review 审查后再由编排者闭票与提交。

- `SoftBody.staticRegion(x, y, z)` 声明静止世界区域；模拟构造按代理静止位置求局部集合，
  `Particles` 装配共享状态时转换索引。重建重新采样，不沿用旧索引。
- 状态分别保存 `staticPrescribed` / `prescribed`，首次上传、密度修改和释放均统一合成
  GPU 逆质量。材料数组不变；每体 `stats().perBody` 提供 `materialNodes`、`staticNodes`、
  `movableNodes`，只统计有材料节点。
- 合成测试使用真实 Simulator/代理离散/Particles/BodyContact，仅替换 PlayCanvas 的 GPU
  存储与调度边界。覆盖非零多体偏移、未声明/空/全区域、静态与运动学重叠、密度/释放/重置/重建。
- 接触测试检查真实上传的双体表面记录保留静态材料，并将这些记录及合成质量送入单对无摩擦
  `collide.wgsl` + `settle.wgsl` 的 CPU 参考运算：静态侧位置为 0，另一侧从 0.015625 m
  推到约 0.02 m。此证据不是 WGSL 执行；真实 GPU 位置验收留给 08。
- 红→绿记录：纯位置入口缺失时测试失败；首次上传尚未合成静态质量时得到 `[2,0,3,4,5]`
  而非 `[2,0,0,4,0]`；Simulator 尚未接通统计时两个构造测试失败。各切片实现后通过。
- `npx vitest run test/unit/staticPrescription.test.js test/unit/kinematicDrive.test.js test/unit/architecture.test.js test/unit/docs.test.js`：4 文件 32 项通过（接触测试添加前）。
- `npx vitest run test/unit/staticPrescription.test.js test/unit/contact.test.js`：2 文件 22 项通过。
- `npm test`：28 文件 265 项通过，包含架构与文档护栏。
- `npm run build`：通过；有 PlayCanvas `node:worker_threads` 浏览器 externalization 与大包提示。
  项目没有独立 typecheck 脚本。
- 未增加目录或修改依赖规则；更新当前架构描述，未改 DECISIONS.md。
  本票不含 02 的拾取/握持资格过滤，尚不能宣称硬/柔交互验收通过；未执行真实资产校准或 GPU 验收。

### 2026-09-21 · independent code-review passed

- 基准 `2502cbc3fd47328b5d3a98b17eec68ba89a70ec4`；审查 `git diff <基准>` 的未提交修改，
  并完整涵盖未跟踪的 `src/sim/staticPrescription.js` 与 `test/unit/staticPrescription.test.js`。
- 两个独立子审查分别执行 Standards / Spec：均 PASS，各 0 项发现、0 项必须修复。
  Standards 核对 CLAUDE、CONTEXT、当前架构与 ADR-0002/0003/0016；Spec 对照完整 spec，
  仅判断本票范围。独立 reviewer 同意通过，可由主编排者提交。
- 独立复验 `npm test`：28 文件、265 项通过；`npm run build`：通过，仍有 PlayCanvas
  `node:worker_threads` externalization 与大包提示。Spec 子审查另复验静态规定、运动学驱动、
  接触、架构与文档测试：5 文件、50 项通过。
- 接触测试采用真实上传记录与单对 CPU 参考计算，已核对对应 WGSL 公式；未执行 GPU。
  02 的抓取资格过滤、08 的真实 GPU 验证及真实资产校准仍待后续票，不代表 alocasia 整体验收通过。
