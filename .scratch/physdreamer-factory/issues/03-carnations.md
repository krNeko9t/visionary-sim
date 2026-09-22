# 03: Carnations 真实资产准备、注册和交互

**What to build:** 用户准备carnations资产后打开 `?scene=carnations`，花、盆与房间完整显示，moving材料可抓取，真实俯拍相机不会让合法数据准备失败。

**Blocked by:** 01 — 共享 PhysDreamer 工厂，保留 alocasia 可运行。

**Status:** resolved

- [x] 仅新增共享工厂场景声明/注册及必要说明，提供真实准备命令和 `?scene=carnations` 入口，无场景专属算法复制。
- [x] 四输入只读、产物ignored；记录输入哈希、变换、尺度、包围盒及三层清洗前后数量。clean高度0.30m是人工声明、比例约.621493；原始高斯1037279，源距离.01前景/背景133564/903715是清洗前基线。
- [x] 必须用真实209帧验证01的up修正。原始最大91.699°在frame_00052；已查该图为强俯拍，frame_00001侧视。按实际判据记录阈值、全部原角、有效/不确定证据和理由；不将源坐标转错来迎合相机up，也不简单将阈值加到92°。父spec投影统计只是辅助，不能宣称全部帧证明世界重力。
- [x] 少量真实r候选与至少两档elementSize校核，真实局部视图检查花/茎和clean固定部分，记录最终r、精度与材料计数。不能盲抄alocasia参数，不因少数边界疑点无限调参。
- [x] 当前Intel UHD770打开真实入口，完整约90万背景高斯不能省略；记录全景和可抓区域证据，完成moving抓取/松手及固定层静止检查，材料/背景职责正确。
- [x] 场景选择/声明必要测试与架构/文档护栏通过；记录实际帧率/丢时、GPU错误和薄茎限制。性能不达标如实交付，不提高每帧步数上限，不扩展为性能重设计或旧08矩阵。

## 交接

详情及原始路径见父spec。该票技术上仅依赖01，实施队列按02之后执行即可。逐票实施→fresh code-review→root提交。


## Comments

### 2026-09-22 · 实施完成，awaiting independent review

基线 `badab2fe1c97a083c639de9020b97987b36212f2`。仅增加 CARNATIONS 声明和共享工厂注册，
没有复制算法，alocasia/hat 参数不变，未实施04，无新增代码目录或依赖边。
Status 保持 ready-for-agent 等待 fresh 独立审查；按用户流程不自行 review/commit。

#### 输入、变换和三层职责

四输入只读，结束时重算SHA-256与报告一致。所有产物/校准CSV/截图/证据脚本位于ignored
`public/splats/carnations`，没有提交原始或派生大资产。

| 输入 | SHA-256 |
|---|---|
| transforms_train.json | `086478be91abe03cb69eccebf856ede66e51f5271bc981d08ae2ddf9d45d07d4` |
| point_cloud.ply | `31536c2e073fe2dafb0c6bff5552e45552557fe27bd0a170c972731527904d60` |
| clean_object_points.ply | `259233ff165a52ae79dc880e721cf6ef21c83f0f6d5dc01d46d2dff719f9e052` |
| moving_part_points.ply | `f10154434a86e60e3df6faba92793283970e1b8429746ef86c8a381d0ec1f6b4` |

原始1037279高斯、clean130812、moving121981；源距离.01得到133564前景/903715背景。
共享清洗后前景81449（剔除52115），在r=.006下动态75956、固定5493；背景305792（剔除597923）。
完整903715背景输入进入共享清洗，没有省略背景或额外裁剪。动态/固定分类在前景清洗之后，
不编造两个子层各自清洗前数量。背景不提供材料、碰撞支撑或抓取资格。

共同变换 `0.6214934617521763*(x,z,-y)+[-.07917021308922949,.2328704945360252,.6231899981478052]`。
clean源尺寸[.266334128,.392103910,.482708216]，米制min[-.082762460,0,-.121845008]、
max[.082762460,.30,.121845008]；0.30m是人工声明的模拟尺度，非实测。
完整源场景min[-3.147916317,-.475839049,-2.502939224]、max[2.066067696,2.959979296,2.559327126]；
米制min[-2.035579622,-1.322689868,-1.216417781]、max[1.204877351,1.823475570,.918920856]。
前景米制y范围[-.004993721,.30]由距离切分产生，没有再次归一化。
`report.json`保存输入出处/全部包围盒/人工尺度声明/变换以及全部209帧原角。

#### up真实验证

采用ADR-0021 projected-world-up，投影长度>=.5的所有帧必须满足55°，不是按角度排除。
209帧矩阵全部合法，202帧有效；最大原角91.699431391°在frame_00052，最大可观测投影角
50.887731749°在frame_00045（长度.526238550），55°留约4.1°观察余量，不改变源+Z。
目视frame_00001为普通侧视，frame_00045为带斜视/滚转的俯拍，frame_00052强俯拍；图像与
声明坐标相容。55°不是复制alocasia原始camera-up语义，不能把原始91.7°放宽到92°通过。
以下7帧仅因投影长度不足而不确定；全部原始/投影角仍保存，不能宣称全部帧证明重力。

| 帧 | 原角° | 投影长度 | 投影角° |
|---|---:|---:|---:|
| images/frame_00047.png | 69.057272837 | 0.499633496 | 44.324533519 |
| images/frame_00048.png | 74.525716076 | 0.465925545 | 55.065733529 |
| images/frame_00049.png | 76.838745885 | 0.360627816 | 50.848140172 |
| images/frame_00050.png | 74.358759179 | 0.355089624 | 40.599088521 |
| images/frame_00051.png | 74.261965348 | 0.336306974 | 36.242356794 |
| images/frame_00052.png | 91.699431391 | 0.239283176 | 97.119442656 |
| images/frame_00053.png | 91.145908542 | 0.220312847 | 95.208101202 |

没有有效帧会拒绝；当前7帧报告各自保留indeterminate原因，不把弱证据当作通过证明。

#### 有限r/h校准与图像

| r (m) | 动态/固定高斯 | h=.016固定/可动材料 | h=.012固定/可动材料 |
|---|---|---|---|
| .003 | 75931 / 5518 | 200 / 442 | 361 / 787 |
| .006 | 75956 / 5493 | 200 / 442 | 359 / 789 |
| .009 | 75986 / 5463 | 199 / 443 | 358 / 790 |

两精度材料总数642/1148，全部无退化、逐点高斯分类跨精度一致；节点沿用最近前景标签延拓。
`calibration-03/calibration.json`及每候选CSV记录完整证据；工具明确不自动作语义校准。
`evidence-03/regions.py`生成三候选上排x/y全花、下排z/y下茎固定区视图：红固定/绿可动。
目视三档花冠和茎均可动，盆内clean固定块保留，候选只改变少量边缘点。选中间r=.006m作为
该资产采样容差，未发现需要扩大到.016m的证据；h=.016m用于当前运行，.012m核对计数。
这不是唯一最优r，也不是按健康节点数断言语义准确。没有第二半径、高度剪裁或伪造静态节点。
maxStretch1.05、damping2/s、柔抓.003s仅初始交互声明，非植物材料实验参数。

#### GPU smoke、证据与复现

```sh
node tools/prepare-physdreamer.js --scene carnations --input /home/liaowanjun/Datas/physDreamer/physics_dreamer/physics_dreamer/carnations --camera-convention opengl-c2w
node tools/calibrate-physdreamer.js --scene carnations --input public/splats/carnations --input-kind real --r=0.003,0.006,0.009 --element-sizes=0.016,0.012 --output public/splats/carnations/calibration-03
npm run dev -- --host 127.0.0.1 --port 5190
VK_DRIVER_FILES=/usr/share/vulkan/icd.d/intel_icd.json google-chrome --user-data-dir=/tmp/physdreamer03-chrome --remote-debugging-port=9354 --no-first-run --no-default-browser-check --disable-extensions --enable-unsafe-webgpu --enable-features=Vulkan --use-angle=vulkan --enable-logging=stderr about:blank
node public/splats/carnations/evidence-03/smoke.mjs
node public/splats/carnations/evidence-03/views.mjs
python3 public/splats/carnations/evidence-03/regions.py
```

校准复跑换新输出目录。正式入口 `http://127.0.0.1:5190/?scene=carnations`；Chrome153.0.8010.47、
ANGLE Intel UHD770 ADL-S GT1/Mesa25.2.8 Vulkan。生产渲染/模拟路径没有替换。
`smoke.json`：642材料节点（200静态、442可动）、316格、535接触节点，分配节点8800不等于材料数。
默认相机射线抓到[.012842204,.134019449,.006616361]，12个握持节点无静态节点。
18帧目标横移4cm，最大材料位移.053007604m；松手后held=0。拖动及松手30帧后位置全finite，
两阶段固定位移均0。固定前景/背景最终GPU dataTransformA/B四份哈希前后相同，保存在smoke.json，
不是仅比较CPU输入数组。为补齐松手后静态位移单独字段，增强证据脚本后复跑一次，最终记录为：
30帧/2.4769s=12.111914fps、丢时1.941171852s，无页面异常或GPU错误；首次运行仅favicon404。
60fps/零丢时未达，按本轮契约不阻止交付，没有提高每帧24步上限或修改背景清洗来改善帧率。

目视`smoke.png`为默认全景，花、盆、桌面、书和窗帘背景完整可辨；`front.png`和`front-wire.png`
显示花/茎/盆内代理。views仅在证据页禁用相机脚本，将相机放在共同变换后的frame1位置看向
[0,.15,0]，不改变生产默认视角/资产。regions图是CSV投影图，未编辑截图。
限制：.016m体积代理比细茎明显更粗，叶和花瓣不构成薄壳；固定边界接缝、自然弯曲和大幅拖动
质量未完全标定。盆体近处也有仅绘制部分，不能当物理支撑。扫描背景存在模糊/缺口；未扩展旧08矩阵。

#### 检查与清理

新增sceneNamed/createBodies/scenery行为回归先红（carnations未知）后绿，沿用已约定共享工厂接缝，
替换I/O/GPU边界，真实代理诊断保持固定和可动材料。定向alocasia/architecture/docs：3文件34项通过。
完整`npm test`初次因沙箱Node spawnSync EPERM失败，提权重跑36文件347项通过；`npm run build`
通过，只有既有worker_threads外置与bundle大小提示。仓库无typecheck脚本。
文档后architecture/docs两文件14项通过，`git diff --check`通过。
四输入结束时SHA-256重验一致，产物和证据git check-ignore确认ignored。
本票专用Vite5190已停止，Chrome9354隔离profile进程已退出，未操作用户浏览器。

待提交文件仅本票、`src/scene/physdreamerDeclarations.js`、`src/scene/scenes.js`、
`test/unit/alocasia.test.js`、`tools/README.md`。交fresh reviewer，未自行提交。

### 2026-09-22 · 独立审查后最小补修

按review的低优先重复建议，将hat/carnations共享注册契约合为
`it.each(['hat', 'carnations'])`；每场景仍有独立测试用例，分别检查资产URL、三层职责、固定区域、
重力/抓取声明及真实代理材料诊断。没有修改运行时、资产或参数。
`npm test -- --run test/unit/alocasia.test.js`：1文件20项通过；`git diff --check`通过。
本次仅改测试与本票，未重复GPU或全套检查，未提交。

### 2026-09-22 · fresh 独立双轴审查完成

审查基线 `badab2fe1c97a083c639de9020b97987b36212f2`，覆盖本票五个未提交文件。
Standards 与 Spec 分别由 fresh gpt-6-astra medium 子代理独立审查。
Standards 无文档硬违规；唯一低优先级测试重复建议已由实施者用 `it.each` 修复，
独立复核确认两场景仍分别执行完整契约断言，该 finding 关闭。Spec 无缺漏、越界或错误实现。

独立定向检查3文件34项通过；四原始输入及三校准输入的SHA-256/字节数重算一致，
9份校准CSV固定/可动计数与记录一致。原矩阵独立重算确认209合法、202可观测、7不确定，
最大原角91.699431°、最大有效投影角约50.88773°。全景、分类与线框图以及GPU证据脚本
支持本票记录；本次审查未重新运行GPU。性能和薄茎代理限制继续保留，不按旧08标准阻塞本轮交付。
最小补修后独立重跑 `npm test -- test/unit/alocasia.test.js`：1文件20项通过，
`git diff --check`通过。最终Standards/Spec均无未关闭finding，票据resolved，交root提交；审查者未提交。
