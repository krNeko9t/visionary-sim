# 08: 在目标 GPU 验证真实 alocasia 的交互、静态性与实时预算

**What to build:** 在真实资产及已校准参数下，完成可复查的目标设备运行验收，证明固定前景及背景严格静止、叶片可交互，并符合现有求解预算。

**Blocked by:** 07 — 真实资产校准；09 — 三层契约；10 — 完整场景背景接入；外部条件：可运行本应用的目标 WebGPU 设备及实际交互/画面/状态观测能力。

**Status:** ready-for-agent — awaiting independent review；性能未通过，接入未完成

- [x] 记录设备、GPU、浏览器、运行条件、资产标识、最终 r、elementSize、材料与观测时间。打开 ?scene=alocasia，可动前景、固定前景及 render-only 背景三层可见且同变换对齐，植物/花盆/房间构成完整场景、重力为零，无应用添加的玻璃缸，现有材质、抓取半径和代理线框控制可用。
- [x] 拖叶片时观察叶柄弯曲、松手回弹并逐渐停止；分别验证硬/柔抓取、驱动切换、松手、改密度、重置之后静态节点及固定前景、背景高斯中心/旋转/尺度不变。保存数值前后对照与可复查图像/录像或等价证据，不只凭截图推断位置恒定。
- [x] 核查静态节点无法作为锚点或进入握持球，射线能继续寻找合格节点；固定接触节点仍对其他物体产生响应（可另用合成双体 GPU 案例），不能以零逆质量或 CPU mock 替代 GPU 行为证据。背景无材料、静态节点、抓取资格或接触表面，背景盆身不能作为碰撞支撑的证据。
- [ ] 检查叶柄连接、薄结构、封口桥接/过厚和静动接缝，保留线框与真实几何对照。不以体积占比三成为硬阈值，不读点阵内部 volume；发现桥接/过厚需报告证据重开选择，不能静默调 r 或填充参数补救。不承诺当前不存在的自接触。
- [ ] 在三层完整绘制负载下，在目标设备按 60 fps 条件记录实测 cfl < 1、每帧 steps <= 24、droppedTime == 0，以及实际帧率/时间与 cflLength。0.75 安全系数、1/240 上界和 c/cflLength <= 1080 s⁻¹ 的理论预算不能替代实测；不得提高每帧上限。
- [x] 完成全套相关行为测试、architecture.test.js、docs.test.js 和构建，记录命令、结果及任何未通过项；修复实现缺陷后重验受影响行为，不放宽点阵知识边界。
- [x] 将最终实测与验收结论记在本票/原 spec；只有 01–10 所需行为、真实校准和 GPU 证据全部通过才宣布接入完成。缺资产、设备、观测能力或验收失败均如实保留为未完成，不以理论、历史或合成证据替代。

## 实施边界

依据原 spec「真实数据与 GPU」「文档与交付边界」。不扩展到其他 PhysDreamer 场景、逐点材料、学得初速度/冲量、运行时锁定/解锁；DECISIONS.md 保持只读。


## Comments

### 2026-09-22 · 完整场景验收范围

按新版 spec 与 ADR-0019 验收，后续顺序为 09 → 10 → 07 → 08，不重编号。
05 保留已完成的旧范围；09 的文档与 10 的接线不能代替 07 的真实校准及本票的实际 GPU 证据。
求解 bounds 仍由前景决定；观察须能检查完整场景及植株，不能因相机裁剪漏掉背景后宣称通过。
性能证据须包含背景绘制负载；静态背景不意味着新增物理盆身或自接触。本次未执行 GPU 验收。


### 2026-09-22 · 正式生产路径真实 Intel GPU 验收，awaiting independent review

本轮使用 implement 与 diagnosing-bugs 技能；依明确分工不自行 code-review、不提交、不派代理。
源码基准 `ce5949a93205cf11be60a2aefb1722e7225a0ea4`。没有修改生产代码、r、材料默认值、
填充参数、24 步上限或背景范围。**当前实现在当前设备未达到 60 fps / 零丢时，08 未通过，
不能宣布 alocasia 接入完成。** 以下勾选只表示对应验收证据已完成，不代表整票通过。

#### 设备、场景与复现

设备 Intel UHD Graphics 770（ADL-S GT1 / i915），WebGPU adapter vendor `intel`、
architecture `gen-12lp`、`isFallbackAdapter=false`；Chrome 153.0.0.0 / Linux x86_64，
PlayCanvas 2.21.3。窗口及画布 **901 × 897，DPR=1**。使用独立 profile、专用 CDP 端口；
没有控制用户原浏览器，也没有采用 SwiftShader。复现命令：

```sh
npm run dev -- --host 127.0.0.1 --port 5188
VK_DRIVER_FILES=/usr/share/vulkan/icd.d/intel_icd.json google-chrome \
  --user-data-dir=/tmp/alocasia08-chrome-intel --remote-debugging-port=9340 \
  --no-first-run --no-default-browser-check --disable-extensions \
  --enable-unsafe-webgpu --enable-features=Vulkan --use-angle=vulkan \
  --enable-logging=stderr about:blank
node public/splats/alocasia/evidence-08/action.mjs open
```

打开的是正式 `http://127.0.0.1:5188/?scene=alocasia`，不是复制 main 的诊断页。
观测脚本、原 GPU 二进制、JSON、截图均放在 ignored `public/splats/alocasia/evidence-08/`。
`action.mjs <script.js> <result.json>` 通过 CDP 执行当前页脚本；`shot <file.png>` 保存截图。
首次 Vite/Chrome 启动遇沙箱 socket EPERM，按权限流程提权运行。

资产沿用 07 正式 55° prepare；0.30 m 是 clean 高度。SHA-256：

| 产物 | SHA-256 |
|---|---|
| foreground.ply | `2c7b90dac649337c2ae868b85442ea4b1b9e8c24394e346378d9faafcb74d50a` |
| moving_part_points.ply | `59c751653820df62ccd4a7d80f6a42fba7f443c2c21bde2984a5c87d4e94dbfd` |
| background.ply | `c6c810b115362fa020644af508a9381d7848448a5de92eed37186ce29eb6a09d` |
| report.json | `73daaa877b4f3edeacdaab44a68ad8278ec53d1459f5dac7d9a6029a7c9047a2` |

r=.016 m、elementSize=.016 m、实测 proxy.cflLength=.016 m；E=120000 Pa、ρ=1000 kg/m³、
ν=.40、friction=.4、damping=.6、relaxation=.012 s，抓取半径 .03 m。零重力 `[0,0,0]`。
三层 **104576 动 + 18303 固定前景 + 325923 背景 = 448802**；前景/背景分别剔除
94526/244449 个低 opacity 高斯。有材料节点 1911，其中固定 827、可动 1084；全部
GPU 节点槽 16704、接触节点 1659、966 格。背景只有一个 scenery entity，无模拟体。
`visual.json` 保存实体列表、UI、观察和物理 bounds；无玻璃缸。`front.png`、`side.png`
显示叶片、叶柄、盆身、盆土与室内背景同变换对齐。背景不被解释为物理支撑。

#### 最终渲染属性与交互矩阵

`install.js` 在正式运行页安装只读观测；通过 PlayCanvas 最终 work buffer 的
`dataTransformA` / `dataTransformB` 纹理 **GPU readback** 比较全部静态高斯，
不是只比较 CPU 属性或 deformationAt 中心。当前 compact 引擎布局为：A.xyz 是 float32
中心的 bit pattern，A.w 为打包尺度/alpha，B 为量化 quaternion。每层全部 word 逐位比较；
声明的是引擎实际渲染精度的恒定，不是未量化四元数的额外精度承诺。
两静态层均无 workBufferModifier。层分配固定为 `[0,18303)`、`[18303,344226)`、
`[344226,448802)`。两静态层的 A/B SHA-256 在矩阵各状态相同：

| 层 | A | B |
|---|---|---|
| 固定前景 | `60bf3993d6c51118d877a2a4d76de17dca302282b649d14b10a14fbda0e165ab` | `4cfa516a3a24f27b80c3e9bc3a9e661c2d56ac4de2755f9153137345b2d53c8d` |
| 背景 | `3b4bdc9526b1523d71f2beae247ab3f279d13c4aa97756637dee8213cc158c18` | `ac35d1fb44206ac239b1294f15b251d336a339194677443c5bc39b88584a2f0a` |

矩阵顺序为 hard / compliant 各一次：GPU ray grab → 30 帧逐渐拖动 +40 mm x →
切换驱动 20 帧 → density 1000→1200 后 20 帧 → 松手 30 帧 → 再运行 150 帧 → reset，
下一轮恢复 density=1000。各状态暂停后读取节点和最终引擎纹理；暂停、读回等诊断时间
不作为性能结论。`matrix-final.json` 为最终顺序执行结果；初次 `matrix.json` 保留，
初次尾段曾与合成接触观测重叠，因此不以它作为最终释放时长证据。最终轮相机固定为
`(.48,.32,.60)` lookAt `(0,.14,.025)`，与 07 连续叶柄定位一致。
`export.mjs` 保存 rest/hard-held/hard-release180/compliant-held/compliant-release180 的
节点及两个原始 GPU 工作纹理，共 15 个 `.bin`；`analyze.py` 可复算所有静态字及连续叶柄。
旧 GPU 中心采样工具仅辅助帧等待/抓取，静态性结论来自最终引擎纹理。

#### 固定拾取与真实 GPU 双体接触

`contact.js` 在同一真实 device 上创建两个解析 box（半边长 .04 m，elementSize=.016），
中心 `(0,.15,0)` 与 `(.075,.15,0)`，第一体全部静态规定，第二体可动，零重力。
分别 reset 后 contact off/on 各运行 30 个固定 1/60 输入帧（0.499885 s 模拟时间）：

| GPU 对照 | 固定 343 材料节点最大位移 | 可动材料节点最大位移 |
|---|---:|---:|
| contact off | 0 m | 1.077e-9 m |
| contact on | 0 m | .02369093 m |

这证明固定接触节点确实对另一个物体产生响应；不是 CPU mock 或仅观察 invMass=0。
reset 后从 `[-.4,.15,0]` 沿 +x 射线穿过固定体，命中 **bodyIndex=1**，18 个握持节点
全属后方可动体、静态节点 0，保留在 `contact.json`。场景握持球矩阵也没有静态节点。
合成模拟器 finally 中移除 update handler 并销毁，不改变生产背景语义；不声称背景盆身有碰撞。

#### 薄结构与接缝观察

`front.png` / `front-wire.png`、`side.png` / `side-wire.png` 是同机同相机的实景/代理
对照（侧面相机 `(.6,.3,.10)`）。已有 UI“显示代理几何”实际点击生效。
16 mm 代理在叶片、细叶柄周围呈明显阶梯状增厚，近邻叶柄区域线框投影出现宽连接区域；
这些图不能独立判定每一处都是非解剖桥接，**未证明薄结构没有不当桥接/过厚**。
不以体积占比当阈值、未读取内部 volume，不调整 r 或填充/封口参数。
这一表示限制交独立 review 判断是否需重开薄结构代理选择；没有擅自重开 07 的根鞘/土边界
校准。静动交界采用 ADR-0015/0019 已接受的接缝取舍；本次不承诺无自接触穿透。

#### 性能：正式完整负载未通过

`performance.js` 在正式默认相机、三层开启、线框关闭、默认材料及运行状态下等待 5 s，
reset 后独立测 20 s。窗口内无截图、GPU readback、接触合成、额外形变采样或逐帧 CDP，
只在 postrender 保存 stats 和 performance.now；没有同时运行测试/build。
`performance.json` 保留逐帧序列和设备/配置。正式窗口：

- 20014.8 ms / 321 帧，**16.0381 fps**；CFL 全部 .75、steps 最大 24。
- 累计 simulatedTime=5.7651457 s，**droppedTime=14.1748948 s**，不满足零丢时。
- `node .../assert-perf.mjs` 输出 `pass:false` 并 exit 1，明确保留失败。

有限成本诊断 `cost.js` 各预热 30 帧后采样 10 s，仍无 GPU readback/截图；
期间另一次保存既有内存快照的 CDP 导出尝试失败，可能引入浏览器序列化干扰，
因此这些成本数值只作粗定位，不作为严格分离的GPU耗时或硬件上限。后两项仅用于定位，
不能冒充三层完整负载验收。实际记录在 `cost.json`：

| 窗口 | 实测帧率 | 时长 | droppedTime |
|---|---:|---:|---:|
| 同配置完整场景复测 | 15.7458 fps | 10.0344 s | 7.0620042 s |
| 三层绘制开启、暂停物理解算 | 18.6828 fps | 10.0092 s | 0（暂停，非运行验收） |
| 关闭全部高斯绘制、保留物理解算 | 49.9990 fps | 10.0002 s | 1.0199758 s |

观察提示绘制与求解均有明显成本；完整复测也没有出现接近60fps的改善。没有进一步 profile
证明具体内核/引擎缺陷，不能据此断言硬件本质不可能达到 60 fps。**当前实现 + 当前设备 +
上述配置未达标**是最终事实。本票未找到有充分证据的小修，不擅自做新的性能架构设计。
最小后续选择是继续以此 GPU 开独立性能优化工作，或明确指定另一目标 GPU 后按相同完整
负载复验；不能删背景、减高斯、提高步数上限或用理论 CFL 预算消除该失败。

#### 测试与交付边界

`npm test` 首轮 312 通过 / 16 CLI 测试遭 spawnSync EPERM；按权限流程提权重跑后
**34 文件 / 328 测试通过**，含 architecture/docs 及全部既有行为测试。
`npm run build` 通过，仅既有大 chunk 提示。没有独立 typecheck 脚本。
只修改本票；大资产/截图/诊断脚本 ignored，不新增架构目录、依赖或 ADR。
最终未通过项为完整场景 60 fps / 零丢时，以及薄结构无不当桥接/过厚尚不能认定；
不是缺资产或缺真实 GPU，也不将这些失败改写为通过。待独立 review。


#### 最终顺序矩阵、同叶柄数值与 UI 补充

所有 12 个状态的静态节点最大位移均 **0 m**，固定前景/背景 A、B 改变字数均 **0**。
硬/柔两轮握持物各 10 节点，静态节点 0；+40 mm 抓取目标在 30 帧内渐进设置。

| 状态 | 最大可动节点位移（m） | 累计模拟时间（s） |
|---|---:|---:|
| hard-held | 0.03999806195 | 0.5387987 |
| hard-switched | 0.0001236655683 | 0.8979978 |
| hard-density | 0.0001459184105 | 1.2914807 |
| hard-release30 | 5.932926849e-07 | 1.8817050 |
| hard-release180 | 6.028988458e-07 | 4.8328269 |
| hard-reset | 0 | 0.0000000 |
| compliant-held | 0.0001229471874 | 0.5387987 |
| compliant-switched | 0.0001229471874 | 0.8979978 |
| compliant-density | 0.0001229471874 | 1.2914807 |
| compliant-release30 | 6.052880291e-07 | 1.8817050 |
| compliant-release180 | 5.354578378e-07 | 4.8328269 |
| compliant-reset | 0 | 0.0000000 |

柔到硬切换时目标已停止，硬律沿既有目标速度推进，因此固定在切换时已有的位置，不把
这次切换描述为瞬间追上 40 mm 目标。密度与切换的静态性通过；柔抓取响应很小，如实保留。

`raw-analysis.json` 从最终引擎 GPU 中心重算 07 已定位的同一连续叶柄
G91888→G84922→G87750→G58086→G60022；后续 G11655/G43697 是同叶叶面参照。
hard-held 五叶柄参照位移为 **.002620 / .010038 / .047278 / .226035 / 1.058968 mm**，
三个三维转角变化 **+.005503 / −.054145 / −.399874°**；release180 五点最大位移
.0000800 mm。可见同叶柄发生弯曲并返回静止附近，沿用 07 无最小幅度门槛的验收。
compliant-held 五点最大 0.001515 mm，同叶叶面 G43697 位移 .074532 mm；release180
五点最大 .0000539 mm。小幅响应不夸大为明显视觉弯曲。
原始工作纹理包含所有高斯中心/旋转/尺度；哈希与改变字数可用 `analyze.py` 独立重算。

`ui-actions.json` 记录通过既有 DOM input/click 事件而非直接调用 sim 的控制验证：
density→1200、抓取半径→.04 m 生效，然后恢复1000/.03；“刚性抓取”点击分别得到
compliant/hard；线框关闭/开启均生效；“重置”点击归零模拟时序且保留827静态节点。
控件测试保持暂停，不混入正式性能窗口。

`boundary-grip.json` 追加真实场景邻近静态节点的握持球核查：硬、柔各选择7个可动节点，
球内静态材料节点2455确实位于 .03 m 范围内，但两种驱动的 heldStatic 均为空；
+5 mm 目标、10帧后静态节点最大位移0，固定前景/背景最终A/B仍全部逐位不变。
这避免仅在远离静态边界的叶面验证过滤。

本次专用 Chrome 9340 已 Browser.close，Vite 5188 已 Ctrl-C 退出130；合成GPU模拟器
已销毁，所有测试/build/导出进程结束。未触碰用户原浏览器，未修改原始Datas。
`system.json` 保存实际GPU系统标识；三个测试/构建日志已复制证据目录。
资产四哈希现场重算与上表完全一致；`git diff --check` 通过。
最终证据文件的相对路径、字节数和SHA-256列于 `evidence-08/manifest.json`，
可独立复算。另有失败的探索性 `switch-check.json`：成本诊断隐藏全部绘制使旧work-buffer
引用失效，读回抛错；随后重新取得当前manager/work-buffer并顺序重跑最终完整矩阵，
没有将该失败文件算作通过，也没有修改生产渲染逻辑。

### 2026-09-22 · 独立两轴审查：记录可提交，08 验收未通过

reviewer `/root/review_08` 使用 code-review 技能，以
`ce5949a93205cf11be60a2aefb1722e7225a0ea4` 为固定基准审查全部工作树差异及
未跟踪文件；唯一 tracked 改动为本票，无未忽略的新增文件。两个全新上下文
astra-medium 子 reviewer `/root/review_08/standards`、`/root/review_08/spec`
分别只读并行核证 Standards / Spec，聚合 reviewer 另独立复算证据并检查四幅正侧面对照图。

- **Standards：0 项规范违规，0 项有依据的新增代码气味。** Comments 追加、源码与
  参数不变、未完成状态及未勾选项符合交付边界。构建日志补充：除大 chunk 提示外，
  还包含既有 `node:worker_threads` 浏览器 externalization 提示；构建通过结论不变。
- **Spec：0 项必须修正的记录错误；功能验收未通过。** 67 项 manifest 字节数及
  SHA-256 全部匹配，manifest 自身 SHA-256 为
  `3ade3bcdd97adb466dff1e7955fe7dccf5ee5922a1547384964d161007aeb78b`。
  聚合 reviewer 只读执行分析逻辑，15 个原 GPU 二进制重算结果与 `raw-analysis.json`
  完全一致；12 状态静态节点位移均 0、固定前景和背景最终纹理改变字数均 0。
  引擎 compact 属性布局、真实 GPU 双体接触、射线与边界握持球、UI 结果支持对应记录。
  边界记录中的 2455 是静态节点索引，不是静态节点总数。
- **已确认通过：** 三层完整场景与设备证据、硬/柔交互后的静态性、同叶柄数值响应与
  释放恢复、固定拾取过滤及双体接触响应。柔抓小幅响应如实保留，不新增 spec 没有的
  最小位移/角度门槛，不重开 07 已接受的四个根鞘交界点限制。
- **真实未通过：** 正式性能窗口独立复算为 321 帧 / 20.0148 s = 16.0381 fps，
  droppedTime=14.1748948 s；CFL=.75 和步数不超过 24 不能抵消帧率与丢时失败。
  受干扰 cost 窗口只能粗定位，不能据此断言当前硬件本质上无法达标。
- **仍待处理：** 正侧面图确有叶片/细叶柄的阶梯增厚与近邻宽连接疑点，未证明无不当
  桥接/过厚；现图不足逐处断言非解剖桥接。后续应针对已有证据处理薄结构代理选择，
  不静默调整 r、填充参数或 24 步上限。性能后续需确认 60 fps 的目标 GPU，再以完整
  三层负载开展必要优化及复验；更换目标设备也不能抹去本次设备的失败记录。

核对全套 34 文件 / 328 测试及 build 通过日志，独立 `git diff --check` 通过；本轮没有
重跑 GPU、改生产代码、改参数或提交。审查仅追加本节。**允许提交准确的验收记录，
不允许将 08 标为 resolved 或宣布 alocasia 接入完成。** 顶部待审文字由本节审查结论
取代；性能与薄结构复选框继续保持未完成，等待目标设备澄清和后续验证。
