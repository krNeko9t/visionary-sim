# 10: 接入共同变换的 render-only 背景并完整绘制三层场景

**What to build:** alocasia 在已有可动与固定前景之外加载现有背景高斯，使盆身、植物和房间共同出现在完整场景中；背景保持静止，仅参与绘制，不改变前景的模拟、静态支撑或抓取行为。

**Blocked by:** 09 — 按用户澄清统一完整场景的三层契约与后续验收。

**Status:** resolved

**Review:** passed — independent Standards 0 / Spec 0

- [x] 消费既有离线准备流程产出的背景，与前景和可动样本共享同一米制变换；运行时不重新归一化、平移或缩放任一层。复用现有加载、静态绘制和资源管理路径，背景不安装形变 modifier，可动前景继续通过既有绑定获得形变。
- [x] 保留 clean 对应的完整前景为唯一模拟源，固定前景保留材料、静态规定和代理接触。背景不得加入模拟源、代理生成、材料统计、静态节点集合、抓取/握持物或接触表面；显示出的背景盆身不被描述为物理支撑或碰撞体，不承诺自接触或叶片不穿盆。
- [x] 三层划分在 09 确定的清洗规则下互斥且完整覆盖保留的场景高斯，所有高斯属性对应关系保持一致；分别报告前景切分、清洗剔除和三层数量，防止漏画、重复绘制或把清洗丢弃误称分类丢失。背景与前景位置、旋转、尺度共享同一变换证据。
- [x] 共享异步准备结果，避免场景不同入口重复读取或分类。空背景合法并显式跳过零高斯资源；需要的背景资产缺失、格式错误或任一层加载失败时明确失败并回收已创建资源，不能以缺背景的部分画面冒充完整场景成功。场景销毁及失败清理不泄漏或重复销毁资源。
- [x] 求解 bounds 仍由前景决定，不因房间背景扩大物理区域；观察能检查完整场景及植株，背景不得因相机裁剪设置而被意外省略。保留零重力、无附加玻璃缸、现有材质/抓取半径/代理线框控制和每帧 24 步上限。
- [x] 合成端到端测试覆盖同变换对齐、三层互斥完整及属性同步、背景与固定前景无形变绑定、模拟更新后静态属性不变、背景无物理资格、共享加载、空背景、加载失败及资源生命周期。显式测试用 r 不进入生产声明，背景变化不影响前景材料/节点统计；运行受影响行为、架构/文档护栏及 build 并记录结果。
- [x] 核对 07 已记录的真实输入、现有背景产物与证据，给出可复查的三层加载/检查路径和对应资产标识。允许通过明确的诊断或合成入口验证接线，但未经校准的真实生产入口仍须拒绝宣称就绪；离线叠图或 mock 不充当实际 GPU 完整场景验收。
- [x] 交付时记录已验证与仍待验收的边界：10 完成允许 07 按新版契约继续校准，07 通过后才进入 08。不得填猜测 r、批准探索 up 阈值、改变 clean 高度含义、重标 clean、扩充物理盆身或提前宣称真实场景接入完成。交独立 code-review 后由编排者提交。

## 依据与真实数据交接

本票实施 09 根据用户澄清修订的三层契约。05 的旧范围已完成，新增范围是将现有背景接入完整绘制。
盆身存在于已经生成的 background 产物，不需要为恢复可见性重新标注 clean。

真实四输入目录：`/home/liaowanjun/Datas/physDreamer/physics_dreamer/physics_dreamer/alocasia`。
准备产物与调查证据分别位于 `public/splats/alocasia/` 和其 `evidence-07/`；
哈希、共同变换、候选 r 与复现方式见 07 的保留记录。原始资产只读，大资产和本机证据不进 git。
当前 r 未校准，up 60° 仅为探索，0.30 m 是 clean 范围高度；这些仍由原有验收流程处理。

不得为了票据编排新增架构目录或调整依赖表。若实现确需新增代码目录或改模块依赖，
按仓库规则同步架构、护栏和 ADR；背景接入不构成放宽点阵知识边界的理由。


## Comments

### 2026-09-22 · 实施及验证，等待独立 review

- `createAlocasiaScene` 的共享准备 promise 同时加载既有 `foreground.ply`、
  `moving_part_points.ply` 和 `background.ply`。前景与背景经过同一个默认 opacity >= 0.1
  清洗入口，校验有限、完整的高斯属性；前景只清洗一次，再按 r 切可动/固定。
  `SoftBody.source` 仅含前景，背景只出现在 scenery，不创建背景物体、代理或静态规定。
  现有材质、抓取半径、零重力、无玻璃缸及 24 步上限保持原声明。
- `scene.counts` 与模拟源 report 分别报告 `inputForeground` / `inputBackground` 原始切分数、
  `foregroundDiscarded` / `backgroundDiscarded` 清洗剔除数，以及 `movableGaussians` /
  `fixedGaussians` / `backgroundGaussians` 三层数。运行时不重新切前景或变换任一层；
  属性同步沿用既有 `subsetCloud`。高阶 SH 仍遵循现有 loader 的舍弃策略，未新增属性损失。
- `scene.bounds` 仍仅由前景外扩、底部 y=0；新增可选 `scene.viewBounds` 为清洗后三层
  中心的联合范围。相机初始对准前景并保留近距离缩放，全场景范围决定远端缩放和 farClip；
  可用既有平移/旋转/缩放检查植株与房间。观察范围不传入 Simulator。
- 固定前景和背景复用 `createSplatView` 无 modifier 路径。空层显式跳过；资产失败在创建
  app/GPU 前拒绝所有共享入口，不展示部分成功。启动清理现覆盖后续绘制失败；直接创建的
  GSplatResource 由 entity 的 destroy 事件释放（引擎先移除 component/placement），
  组件创建失败也回收资源。app 销毁统一释放 simulator，失败清理不会重复销毁。
- 合成测试沿既有公开场景、启动与绘制边界扩展；离线 CLI → 真实 PLY loader → 场景组装
  案例验证共同变换位置/旋转/尺度、三层覆盖及完整属性对应。其他案例覆盖共享加载、
  清洗计数、背景增减不改变前景源/bounds/模拟材料统计、空背景、缺失/非有限/不完整背景、
  无静态层 modifier、模拟参数缓冲更新后静态资源属性不变、绘制失败及销毁生命周期，
  以及大观察范围下的近距缩放和远裁剪。GPU API 在合成测试中替换，不能视为真实 GPU 执行。
- 定向 `npm test -- --run test/unit/alocasia.test.js test/unit/prepareAlocasia.test.js`
  为 23/23 通过；该轮 CLI 既有 8 项先遇沙箱 spawnSync EPERM，按权限流程提权重跑通过。
  随后补齐生命周期和相机测试，最终 `npm test` 为 **34 文件 / 327 测试通过**，
  包含 architecture/docs、既有物理及抓取回归；`npm run build` 通过，保留既有
  PlayCanvas worker 外部化和大 chunk 提示。仓库没有独立 typecheck 脚本。
- 未新增代码目录、未改依赖表，不需要依赖 ADR；Scene 接口文档随代码更新。
  未自行执行 code-review、未提交；以上勾选表示实施证据已交付，Status 保持 ready-for-agent，
  待编排者安排全新独立 reviewer 后决定提交。

#### 真实资产只读核对及 07 交接

本轮对原始四输入逐个计算 SHA-256，与 `evidence-07/input-manifest.json` 完全一致；
原始路径仍为 `/home/liaowanjun/Datas/physDreamer/physics_dreamer/physics_dreamer/alocasia`。
现有准备产物也逐个核对，与 07 记录一致（本轮未重写资产）：

| public/splats/alocasia/ 产物 | SHA-256 |
|---|---|
| foreground.ply | `2c7b90dac649337c2ae868b85442ea4b1b9e8c24394e346378d9faafcb74d50a` |
| moving_part_points.ply | `59c751653820df62ccd4a7d80f6a42fba7f443c2c21bde2984a5c87d4e94dbfd` |
| background.ply | `c6c810b115362fa020644af508a9381d7848448a5de92eed37186ce29eb6a09d` |
| report.json | `6ef9985fcdfa390ce60ac087f64cfd0b23e9bf78bd09b800261bd2d58e57c68c` |

只读加载现有 PLY 并调用运行时同一个 `cleanAlocasiaCloud`，不选择 r，得到：

| 层 | 离线切分数 | opacity 清洗剔除 | 保留 |
|---|---:|---:|---:|
| 完整前景（尚未确定可动/固定最终数） | 217405 | 94526 | 122879 |
| 仅绘制背景 | 570372 | 244449 | 325923 |
| 全场景 | 787777 | 338975 | 448802 |

背景清洗后中心 bounds（m）为 min `[-1.1549907923,-1.0539733171,-1.1634668112]`、
max `[0.9029322863,0.8584544063,1.9775487185]`；背景最低点低于 clean 的 y=0
是既有共同变换结果，不重新抬高背景。共同变换仍为 07 的
`0.7173768723015004 * (x,z,-y) + [0.4086767142291841,0.2953821639786183,-0.12676025662402426]`，
0.30 m 仍为 clean 高度。`report.json` 的 60° 仅为探索，本票没有批准 up 阈值或任何 r。

可复查入口：

1. 合成端到端：运行上述 prepareAlocasia / alocasia 测试命令；不需要真实资产或 GPU。
2. 真实 CPU 接线诊断：启动 `npm run dev`，在浏览器 console 导入
   `const { createAlocasiaScene } = await import('/src/scene/alocasia.js')`；
   由 07 明确给出待调查的 `candidateR` 后执行
   `const diagnostic = createAlocasiaScene({ r: candidateR }); const layers = await diagnostic.prepare()`，
   检查 `diagnostic.counts`、`diagnostic.bounds`、`diagnostic.viewBounds`、
   `layers.bodies[0].source` / `.render` 和 `layers.scenery` 两项。
   这是仅加载/分类诊断，无 GPU 画面，不把候选写入生产声明。
3. 真实图像调查仍可复查 `evidence-07/views/foreground-split-side.png`、
   `clean-moving-side.png`、候选节点图及其生成脚本；这些是离线图，不是 GPU 验收。
4. 生产 `?scene=alocasia` 仍因 r 未校准明确失败；07 完成新版语义校准并声明唯一 r 后，
   同一生产路径才显示可动前景、固定前景、背景。届时 `window.scene.counts`、
   `await window.scene.scenery()`、`window.bodies` 及现有代理线框可辅助 08 检查。

10 的接线允许 07 沿现有输入继续校准；07 通过后才进入 08。真实三层画面、近处盆身/房间
完整可见性、相机实际导航、GPU 静态性、交互和完整负载帧率未在本票验收。
没有重标 clean、补充物理盆身或承诺叶片不穿盆；背景没有物理支撑/接触/抓取资格。
不宣称整个 alocasia 接入完成。

### 2026-09-22 · 独立 code-review 完成

全新独立 reviewer `/root/review_10` 按 code-review 技能核证，基准为
`04e81ef5ec1a20b221e9ee69b97147abc8003ba7`；范围为 `git diff <基准>` 的全部工作区差异，
以及 `git ls-files --others --exclude-standard` 列出的 `test/unit/stage.test.js` 全文。
受平台线程名额限制，两轴由编排者串行启动全新独立线程，未复用旧 reviewer，也未由编排者
代做技术检查：`/root/review_10_standards` 和 `/root/review_10_spec` 分别独立只读审查后，
由 reviewer 聚合结论。

- **Standards：PASS，0 项发现。** main 保持组装职责，没有新增 UI 监听；复用既有渲染绑定，
  完整前景仍是唯一模拟源，背景不扩大求解范围；未新增目录或修改依赖表。证据与验收边界
  表述准确；无文档规范违例或需报告的 smell。
- **Spec：PASS，0 项发现。** 共同变换、统一清洗、三层互斥及属性同步、共享准备、空背景、
  失败清理和销毁、观察与求解范围分离、合成覆盖及真实数据交接符合本票；生产 r 门禁保留。
- reviewer 独立重跑 `npm test`：34 文件 / 327 测试通过。首次沙箱 CLI 子进程遭
  `spawnSync EPERM`，按权限流程提权重跑通过。`npm run build` 与 `git diff --check` 通过；
  build 仅有既有 worker 外部化和大 chunk 提示。两轴未重复运行测试。
- reviewer 另核对 PlayCanvas 本地销毁源码，确认先移除 gsplat component/placement，再触发
  entity destroy 释放直接创建的资源；四项准备产物 SHA-256 与本票记录一致。

本票可提交，状态置为 resolved；reviewer 仅更新本票，没有修改实现或执行提交。
这只完成背景接线范围：真实 r、最终 up 阈值仍由 07 校准，真实三层画面、相机导航、GPU
静态性、交互与完整负载帧率仍由 08 验收。0.30 m 保持 clean 高度含义，不扩大物理域，
不宣称整个 alocasia 接入完成。
