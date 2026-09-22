# 01: 共享 PhysDreamer 工厂，保留 alocasia 可运行

**What to build:** 将当前已接受的 alocasia 经小配置接入共享运行时和离线准备/校准工厂，后续场景无需复制算法；用户仍能用原命令准备并从原入口拖动植物。

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] 满足父spec的最小工厂interface：一个共享加载/分类/组装实现，一个共享离线prepare与calibrate实现；正式通用CLI以scene选择声明，旧alocasia命令为薄兼容入口，错误含场景名及诊断。
- [x] alocasia已接受的r、elementSize、材料、柔抓、变换、完整背景和标签延拓全部保持；工厂只把真实变化项留在小配置中，不新增求解器或绑定分支。
- [x] 核对父spec中的真实相机差异，修正up检查使合法强俯拍不被误称为错误世界up。保留逐帧原始角和矩阵合法性，最终阈值/定义有依据；最小方案可改现有判据或在必要时引入模式，记录选择理由，不仅放宽到92°。旧alocasia检查兼容，合成错误坐标轴、倒置、无证据仍可诊断。
- [x] 无固定材料是否可接受由明确场景声明决定；校准和运行时一致。空材料/空moving/无可动材料失败；alocasia仍要求固定支撑。不为了未来可能性新增固定区域算法。
- [x] 共享变换及资产原输入保护、最后发布report、失败失效旧产物、报告scene/声明/出处、场景输出隔离保持。原资产与衍生产物均不入git。
- [x] 测试共享interface的三分法、清洗、节点标签延拓、配置独立性、全动合法声明/错误诊断、旧CLI兼容和up判据。现有alocasia相关回归及架构/文档护栏通过；依赖入口改名同步护栏并写ADR，新增代码目录同步架构。
- [x] 在当前Intel UHD770打开 `?scene=alocasia`，真实资产出画面并完成一次抓取/松手，记录命令、画面证据与实际结果；无需重跑旧08全部矩阵。实际新增场景注册留给后续票。

## 交接

以父spec及最新HEAD为准。每票由全新上下文实施agent完成，再由另一个fresh reviewer执行code-review，root负责提交。up辅助投影统计仅是证据，不是指定设计。


## Comments

### 2026-09-22 · 共享工厂实现完成，awaiting independent review

基于 HEAD `e9f968116db7739c7d7fb200c444fb0faf7d4acd` 当前行为提取；没有恢复旧标签边界，
没有改 alocasia r=.016、elementSize=.016、maxStretch=1.05、damping=2 /s、柔抓=.003 s。
`src/scene/physdreamer.js` 负责共享加载/组装，`physdreamerData.js` 负责共享清洗、标签延拓与
材料失败判据，`physdreamerDeclarations.js` 目前仅含 alocasia。旧 runtime/Data/CLI 均薄兼容；
通用命令为 `prepare-physdreamer.js --scene alocasia` 与 `calibrate-physdreamer.js --scene alocasia`，
完整参数见 tools/README.md。没有注册 hat/carnations/telephone 或校准其 r，也没有重写已接受产物。

ADR-0021 记录共享具名离线依赖入口与 camera-up/projected-world-up 的取舍。新模式把近光轴
世界 up 标为不确定，不按偏角超阈值排除；所有帧先检查右手刚体矩阵，全部原角保留，无有效
证据拒绝。alocasia 仍是旧 camera-up 55°。只读复核四份真实 transforms_train.json：

| 场景 | 帧数 | 原角最大° | 检查模式/阈值° | 检查角最大° | 不确定帧 |
|---|---:|---:|---|---:|---:|
| alocasia | 226 | 53.281465 | camera-up / 55 | 53.281465 | 0 |
| hat | 207 | 38.500054 | projected-world-up / 25 | 22.904085 | 0 |
| carnations | 209 | 91.699431 | projected-world-up / 55 | 50.887732 | 7 |
| telephone | 181 | 23.266399 | projected-world-up / 20 | 15.814267 | 0 |

后三行是本票只读工厂核对，不代替各票的局部原图与参数采用记录。证据命令
`node public/splats/alocasia/evidence-factory-01/cameras.mjs`，逐帧结果 cameras.json；原始 Datas 只读。
相机证据不能测得重力，也不能保证 carnations 那 7 帧的世界竖直。

测试：第一次定向 CLI 测试因沙箱 Node spawnSync EPERM 失败，提权原命令后 48/48 通过；
扩展共享声明隔离、CLI等价、显式全动与相机判据后 54/54 通过。最终 `npm test`：36 文件、
345 测试全部通过（含 architecture/docs）；`npm run build` 通过，保留依赖 worker_threads
浏览器外置和 bundle 大小提示。`git diff --check` 通过。无独立 typecheck 脚本。

实际生产入口 smoke：

```sh
npm run dev -- --host 127.0.0.1 --port 5188
VK_DRIVER_FILES=/usr/share/vulkan/icd.d/intel_icd.json google-chrome \
  --user-data-dir=/tmp/physdreamer01-chrome --remote-debugging-port=9352 \
  --no-first-run --no-default-browser-check --disable-extensions \
  --enable-unsafe-webgpu --enable-features=Vulkan --use-angle=vulkan \
  --enable-logging=stderr about:blank
node public/splats/alocasia/evidence-factory-01/smoke.mjs
```

独立浏览器 Chrome/153.0.8010.47，Intel UHD Graphics 770（Mesa 25.2.8，Vulkan），
正式 `http://127.0.0.1:5188/?scene=alocasia`，868×897 截图 smoke.png 已目视检查植株、盆身、
室内背景完整可见；smoke.json 保存实际统计。观测脚本第一次用了引擎不再暴露的 resource.data
接口而失败，修正为最终 GPU dataTransformA/B 读取后完成；没有修改生产渲染路径。

三层数量仍为 104576 动态 + 18303 固定前景 + 325923 背景；完整前景 122879，清洗剔除前景
94526、背景244449。材料节点 1911：固定463、可动1448（ADR-0020 当前标签延拓），966格。
一次生产 ray grab 抓到14节点，18帧拖动4 cm后最大材料位移0.0405602 m，固定节点最大位移0；
松手后 held=0，两个静态层最终GPU A/B缓冲SHA-256前后一致。没有GPU/页面错误。
完整负载松手阶段30帧/2.7791 s = 10.7949 fps，丢时2.22105 s；这是短smoke观察，
不是60 fps验收通过，也不替代旧08或薄结构完整检查。性能失败不阻止本轮实现交付。

所有 smoke 脚本/JSON/截图在 ignored `public/splats/alocasia/evidence-factory-01/`；
未提交原始或派生大资产。依分工没有自行 code-review、提交或派子代理。

### 2026-09-22 · 独立双轴审查通过

全新上下文 reviewer 按 code-review 技能，分别派出两个全新 astra-medium 只读子代理执行
Standards / Spec；以 `git diff e9f968116db7739c7d7fb200c444fb0faf7d4acd` 为基准，
完整纳入 `git ls-files --others --exclude-standard` 的 10 个新文件。两轴均 0 findings，
没有必修项；本票可由 root 提交，后三场景注册与真实校准仍归 02–04。

reviewer 独立核对共享加载与实例缓存隔离、alocasia 薄兼容、全动声明和材料失败判据、
离线输入保护及发布/清理顺序。独立重跑 6 文件 54 项定向测试全部通过，含 CLI、up、
architecture/docs；首次沙箱 spawnSync EPERM 后原命令获自动批准提权重跑通过。
`git diff --check` 通过。Spec 子代理另独立复核四场景真实相机输入，复现全部记录统计，
包括 carnations 原角 91.699431°、投影角 50.887732°及 7 帧不确定。

已阅读 smoke 脚本与 JSON，目视 smoke.png：植物、盆身和背景可见；证据使用正式入口的
实际 grab/moveGrab/releaseGrab，并比较静态层 GPU 缓冲哈希。1911 材料节点、463 固定、
1448 可动，抓取位移约 4.056 cm、固定位移 0、松手 held=0 与票记录一致。此审查核证
已有 GPU smoke 产物，没有重跑 GPU smoke 或旧08矩阵；10.795 fps 与丢时 2.221 s
仍是未达到性能目标的限制。reviewer 仅修改本票状态和此审查记录，没有实现修复或提交。
