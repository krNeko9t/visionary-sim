# 03: 用同一个米制距离区域分类高斯中心与节点

**What to build:** 场景可将任意静止世界位置一致地归为可动或固定，并把一次清洗后的完整前景拆成互斥且完整的绘制子集，为模拟体提供同一个静态区域判据。

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] 场景侧纯逻辑以到可动 xyz 样本集合的欧氏最近距离判定：小于或等于 r 为可动，大于 r 为固定；空样本集合返回全固定。无效/非有限样本、查询坐标或容差明确报输入错误，负容差拒绝，零容差边界定义清楚。
- [x] 查询采用适当空间索引而非对每个节点扫描全部样本；只加速、不近似改变判据，不 import 点阵驻留区内部工具。
- [x] r 与 elementSize、节点间距和 CFL 无关；同一坐标在不同采样中分类相同。高斯按中心整体归类，不拆跨界高斯，也不以椭球范围扩张判据。
- [x] 一次清洗后的完整前景按同一结果生成可动与固定子集，保留所有高斯属性的对应关系；两个子集互斥且完整覆盖输入。可以复用已有 subsetCloud。
- [x] 用小规模暴力最近距离参考对照索引结果，覆盖边界、空集、重复点、桶边缘、负坐标、输入排列和重跑确定性；覆盖不同离散采样以及全部属性同步与空子集。
- [x] 测试不依赖真实资产/GPU；记录命令和结果，架构与文档护栏通过。不得先填未经校准的 alocasia r。

## 实施边界

依据原 spec「固定区域与高斯分类」「模拟与绘制的组装」及 ADR-0014/0015。此票只提供可复用的场景分类与拆分行为；具体加载、模拟和绘制在 05 接通。


## Comments

### 2026-09-21 · 实现完成，awaiting independent review

- Status 保持 `ready-for-agent`；依用户分工未自行 code-review、未提交，等待主编排者安排独立审查。
- 新增 `src/scene/metricRegion.js`：`createMetricRegion(samples, r)` 接收平铺 xyz 米制样本，返回同一声明的 `movable(x,y,z)` 与 `staticRegion(x,y,z)`。平衡 k-d 树按分割轴距离剪枝，候选使用 `Math.hypot` 精确比较 `<= r`；没有离散化依赖，无默认 r。零容差仅包含完全重合位置；空样本全固定；无效样本、容差和查询明确报错；声明复制输入，不受外部数组后续修改影响。
- 同文件 `splitCloudByRegion(cleanedCloud, region)` 对已统一清洗的完整前景逐中心分类一次，复用 `subsetCloud` 生成保持源顺序的互斥完整子集。全部五类属性保持对应；高斯范围不扩张区域；保留调用者完整模拟源；空子集合法，实际跳过空绘制资源由 05 组装负责。
- 新增 `test/unit/metricRegion.test.js`，10 项合成测试覆盖欧氏边界、零/空、非法与极值、重复点、空间分割边缘与负坐标、暴力参考、排列与重跑确定性、样本所有权、粗细节点采样，以及清洗后子集/交错属性/空子集。均无需真实资产或 GPU。
- TDD 证据：初始边界测试因模块缺失失败；输入错误测试因 null 错误信息不符合契约失败；拆分测试因接口未实现失败。逐步实现后全部转绿。
- 定向命令：`npm test -- test/unit/metricRegion.test.js test/unit/architecture.test.js test/unit/docs.test.js`，3 文件 / 23 测试通过。
- 最终全套：`npm test`，29 文件 / 283 测试通过；`npm run build` 成功（PlayCanvas `node:worker_threads` 浏览器外置及大包体积提示）；`git diff --check` 通过。项目没有独立 typecheck 脚本。
- 无新增目录或依赖规则变更；无需改架构表或新增依赖 ADR。没有校准或填写 alocasia r，也未进行真实资产/GPU 验收。

### 2026-09-21 · 独立提交前 review 通过

- 独立 reviewer 按 code-review 技能，派全新上下文 `gpt-6-astra` / `medium` 的 Standards 与 Spec 两轴只读审查；两轴均为 **PASS，0 项发现**，没有必须修复项，03 可提交。
- 审查基点为 `35ce7977484b91611d04465cccb54bb3641a647a`；范围包含 `git diff 35ce7977484b91611d04465cccb54bb3641a647a` 及 `git ls-files --others --exclude-standard` 中 `src/scene/metricRegion.js`、`test/unit/metricRegion.test.js` 的全文，未遗漏未跟踪实现与测试。
- Standards：场景侧距离逻辑、静态区域声明、中心分类和复用子集逻辑符合仓库规则与 ADR-0014/0015/0016；没有新增目录、修改依赖规则或把进度写入架构文档。
- Spec：独立米制容差、精确欧氏边界、空集与非法输入、空间索引、采样一致性、属性同步与互斥完整子集均满足 03 范围；暴力参考及明确边界测试覆盖相应契约。
- reviewer 独立复跑 `npm test -- test/unit/metricRegion.test.js test/unit/architecture.test.js test/unit/docs.test.js`：3 文件 / 23 测试通过；`npm test`：29 文件 / 283 测试通过；`npm run build` 成功，仅见 PlayCanvas `node:worker_threads` 浏览器外置与包体积提示；`git diff --check` 通过。
- 本次 review 仅更新当前票据，未实现、修复或提交代码。未校准真实米制 `r`；空子集绘制资源跳过留给 05，真实资产/GPU 验收留给 08。本票 resolved 不代表 alocasia 场景验收完成。
