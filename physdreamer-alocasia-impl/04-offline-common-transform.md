# 04: 离线核对坐标并确定地产出共同米制前景、可动样本与背景

**What to build:** 一条可重跑的离线命令读取场景高斯、clean xyz、moving xyz 与相机位姿，核对 up 后以唯一共同变换产生运行时资产和可审计报告。

**Blocked by:** 03 — 用同一个米制距离区域分类高斯中心与节点（复用已验证距离查询）。

**Status:** resolved

实施已完成，awaiting independent review；尚未提交。

- [x] 输入为 point_cloud.ply、clean_object_points.ply、moving_part_points.ply、transforms_train.json。两份样本只按 xyz 处理，不要求有高斯字段或相同数组索引，不以数组相减分类。
- [x] 使用相机位姿 up 核对声明的 +Z up，角度阈值显式声明并报告；缺位姿、格式/坐标无效或偏角超过阈值停止，不假称已核对。说明实际采用的相机坐标约定与 up 推导。
- [x] 沿用 z-up 到 y-up 约定，以转正后的 clean 前景参考高度声明 0.30 m 比例，底部 y=0、水平居中；所有点云共用同一旋转、比例与平移，高斯旋转和尺度同步变换。不得分别归一化或按最长轴替代高度。
- [x] 共同变换后按高斯中心到 clean 样本距离切分前景/背景；声明源坐标 0.01 阈值并换算为米制，明确它与可动 r 不同且待真实复核。
- [x] 完整前景高斯、变换后的可动 xyz、背景高斯产出到 public/splats/alocasia/，产物不入 git。输出格式与读取约定可由运行时消费，运行时无需再摆放；保留所有需要的高斯属性。
- [x] 打印实际变换、up 偏角/阈值、米制尺度、前景/房间尺寸及各输入输出数量，重跑确定。异常失败不能留下可误用为成功资产的结果。
- [x] 以临时合成 PLY/位姿做真实 CLI 往返测试，覆盖对齐、旋转/尺度、距离换算、背景分离、缺位姿/up 失败和重复执行确定性；记录命令、输出与测试结果，合成数据不冒充真实资产。
- [x] 离线依赖不进入运行时。新增工具代码目录时同步架构目录表、依赖护栏及必要 ADR，不以现有护栏只扫描 src 为由豁免；相关护栏和 build 通过。

## 实施边界

依据原 spec「数据准备」。本票不依赖真实资产到位，可用合成输入完整验收工具；真实变换及前景阈值核对在 07。原始数据不得伪造，历史数量和尺寸不是本轮测量。


## Comments

### 2026-09-21 · 实施与合成证据（awaiting independent review）

- 新增 `tools/prepare-alocasia.js`。复现入口：
  `node tools/prepare-alocasia.js --input /path/to/originals --camera-convention opengl-c2w --up-threshold-deg 15`。
  默认输出 `public/splats/alocasia/`；测试传入 `/tmp/alocasia-*/out`，不会生成伪真实资产。
- 输入为现有读取器支持的 binary little-endian PLY；clean/moving 只读 xyz。相机采用
  OpenGL/Blender camera-to-world 的第二列作为 up，逐帧检验刚体矩阵及最大偏角；约定和阈值
  都必须通过 CLI 显式声明。真实数据必须先确认其相机约定，不自动猜测格式。
- 合成 CLI stdout 实测：源 clean 高度 2，`scaleMetresPerSourceUnit=0.15`，目标高度 0.30 m；
  translation 为约 `[-1.8,-4.5,3.15]`，源距离 0.01 换算为 0.0015 m；clean 转正尺寸
  `[0.6,0.3,0.3]`（最长轴 0.6，证明未按最长轴替代高度）。输入 scene/clean/moving=4/2/1，
  输出 foreground/background=2/2；相机 up 偏角 0°、阈值 15°。
- 叶片样本与对应高斯输出中心均约 `[0.3,0.3,-0.15]`；单位高斯四元数变为
  `[-sqrt(1/2),0,0,sqrt(1/2)]`，原标准差 `[2,3,4]` 变为 `[0.3,0.45,0.6]` m。
  额外 `f_rest_0` 属性保留，重复执行四个产物逐字节一致。高阶 SH 原样保留，当前运行时仅使用 DC 色彩。
- 缺位姿、错误 up、无效矩阵、非有限 xyz、零高度均失败，失败重跑后旧输出被清除。
  另以 30° 相机偏角验证：31° 阈值成功并报告约 30°，15° 阈值失败。
- 定向命令：`npm test -- test/unit/prepareAlocasia.test.js test/unit/architecture.test.js test/unit/docs.test.js`，
  **3 文件 / 21 测试通过**。初次红测试为 CLI 文件不存在；实现后沙箱拦截子进程（EPERM），
  通过允许的提权执行测试后通过，未绕过或跳过 CLI 测试。
- 结尾 `npm test`：**30 文件 / 291 测试通过**；`npm run build`：通过，1280 模块。
  build 仍报告 PlayCanvas `node:worker_threads` 浏览器 externalization 与较大 chunk 提示。
- `tools/` 已加入 §二目录表、依赖/知识边界扫描及 docs 双向目录核对；依赖理由见 ADR-0017。
  无新增 npm 依赖，产物目录已加入 gitignore。运行时资产用现有 readPly/cloudFromPly 消费，不需再摆放。
- 本票仅完成离线工具与合成验收；没有真实原始资产，不把上述数字当作真实复测。
  真实相机约定、米制尺度、前景距离 0.01 的语义复核以及可动 r 校准留第 07 票。
  未提交，未自行 code-review，等待主编排者独立 reviewer。

### 2026-09-21 · 独立 review P2 修复（awaiting independent re-review）

- Review 指出旧产物 `foreground.ply` 若被替换为空目录，删除它时 EISDIR 会中止清理，
  原 `report.json` 与其他 PLY 残留，违背报告作为完整发布标志的约定。
- 新增真实 CLI 故障回归：成功执行一次，再将 foreground 替换为空目录，原参数重跑。
  修复前 `npm test -- test/unit/prepareAlocasia.test.js`：7 通过、1 失败；实际残留
  background、foreground 目录、moving、report 四项，成功复现 review。
- 修复后清理先删除 report，再逐个尝试删除 PLY；单项失败不阻止后续清理，最终抛出首个
  真实文件系统错误。发布顺序仍是 report 最后。异常同名目录不递归删除；临时目录清理错误
  也不会覆盖原始失败诊断。README 同步说明顺序。
- 回归实测 exit=1、stdout 为空、stderr 保留 foreground 的 EISDIR；输出目录仅余
  `foreground.ply` 异常目录，report 与其余 PLY 均不存在，不再残留旧成功标志。
- 定向 `npm test -- test/unit/prepareAlocasia.test.js test/unit/architecture.test.js test/unit/docs.test.js`：
  3 文件 / **22 测试通过**；全套 `npm test`：30 文件 / **292 测试通过**；
  `npm run build` 通过（既有 PlayCanvas externalization / 大 chunk 提示不变）。
- 仅修本 P2，Status 保持 ready-for-agent；未提交、未自行 review，等待独立复审。

### 2026-09-21 · 独立两轴复审通过

- 以 `git diff 42fbcdf562e8dd938a4fa605b069b2e326f1b8c7` 为基准，并全文纳入
  `git ls-files --others --exclude-standard` 的四个新增文件；Standards 与 Spec
  由两个独立上下文 reviewer 分别审查。初审 Standards 通过，Spec 发现一项 P2。
- 该 P2 已独立确认闭环：清理先使 report 失效，单项删除失败继续清理其他产物并保留首错；
  发布仍最后放置 report。真实 CLI 的 EISDIR 回归验证失败后仅余异常 foreground 目录，
  不残留旧报告或其他 PLY。复审 Standards / Spec 均 PASS，无剩余必须修复项。
- 复审独立执行定向测试：3 文件 / 22 测试通过；Spec reviewer 另独立执行 CLI 测试
  8/8 通过。`git diff --check` 通过。CLI 测试使用已允许的提权执行，未跳过子进程。
  初审独立全套 291 测试及 build 已通过；修复后的全套 292 与 build 结果见上方实施记录，
  本次复审聚焦受影响路径，未将实施者的全套结果冒称独立重跑。
- 第 04 票可提交，尚未提交。结论仅覆盖离线工具与合成验收；真实资产核对、可动 r 校准
  和整体场景验收仍留后续票据，不因本票 resolved 而视为完成。
