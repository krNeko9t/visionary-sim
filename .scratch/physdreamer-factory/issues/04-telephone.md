# 04: Telephone 真实资产准备、注册和交互

**What to build:** 用户准备telephone资产后打开 `?scene=telephone`，完整电话场景可见，moving材料可以抓取，较小的clean固定区域得到如实处理。

**Blocked by:** 01 — 共享 PhysDreamer 工厂，保留 alocasia 可运行。

**Status:** resolved

- [x] 使用共享工厂小配置接入，给出从真实原始目录准备到 `?scene=telephone` 的命令；无算法复制、无新的main事件监听。
- [x] 原资产只读、产物ignored；记录哈希、共同变换、尺度、源/米制尺寸、三层清洗前后数量。原始590870高斯、clean74958、moving73076；clean高度0.30m为人工声明，比例约.548394；源距离.01切分前景/背景75858/515012为清洗前基线。
- [x] 按01的up判据核对181真实帧，原角最大23.266°，记录实际阈值/理由并检查局部原图/变换。不照抄55°或把相机up当测得重力。
- [x] 少量独立米制r候选与至少两档elementSize、局部视图校核后落定配置；本场景固定样本少，检查容差是否把固定区域吞掉。记录固定/可动高斯与材料节点；若真实证据支持全动，明确声明并记录原因，不伪造固定节点。空/全固定仍诊断失败。
- [x] 当前Intel UHD770真实打开入口，完整场景与可抓区域有可复核画面证据，moving抓取/松手响应正常，固定前景及背景静止。记录设备、材料计数、实际简短性能及限制，不重跑旧08矩阵。
- [x] 场景注册/声明必要回归、架构/文档护栏通过；文档列出四场景正式准备命令与入口，旧alocasia命令仍兼容，已接受alocasia数值保持。性能目标未通过如实记录但不阻止交付。

## 交接

详情及原始路径见父spec。仅真实依赖01，队列按03之后执行。逐票实施→fresh code-review→root提交；收尾不要把证据不足写成全部验收通过。

## Comments

### 2026-09-22 · 实施完成，awaiting independent review

基线 `d6e605f7a020bd4142a38fdc91bcea5a0c4fd9ba`。增加 TELEPHONE 小声明及共享工厂注册，
`?scene=telephone` 可运行；没有复制算法、main事件监听、新代码目录或依赖边。
alocasia/hat/carnations 的参数和行为不变。Status 保持 ready-for-agent，交 fresh 独立审查；
按用户逐票流程不自 review、不 commit。以下是实施证据，不将性能或薄结构质量记为全部通过。

#### 输入、尺度、三层

四输入始终只读，结束重算SHA-256与准备报告一致。派生产物/CSV/截图/脚本全在ignored
`public/splats/telephone`，git check-ignore确认；不提交原始或派生大资产。

| 输入 | SHA-256 |
|---|---|
| transforms_train.json | `5abdc4807754813447b9479457e5ccc87261abf647abafa1f8f7601739dc3de2` |
| point_cloud.ply | `9f9736fd56af0a3d0286a8421b798e9714b594dc1562edab579eb94bd728bdff` |
| clean_object_points.ply | `90a893f9534179f4a5a8f958f49d34132203cb011bead2440f32f3946ec06b6e` |
| moving_part_points.ply | `670d339fd887f748bae82c133fcea8959195985987fb4d8da5590a47e8f114bd` |

原始590870高斯、clean74958、moving73076；源距离.01切分75858前景/515012背景。
共享清洗后前景37627（剔除38231），r=.003下动态35767、固定1860；背景271861（剔除243151）。
完整515012背景输入进入共享清洗，无额外裁剪。动态/固定在清洗后分类，不编造其各自清洗前数。
clean与moving为距离样本，非数组相减；固定前景仍是材料，cloud其余部分仅绘制，不参与抓取、
接触或弹性支撑。电话机多数部分属于仅绘制层，不能从视觉邻接推断它是物理支撑。

共同变换 `.5483936720950742*(x,z,-y)+[.20558376518057175,.21577123874511414,.4574313789453797]`。
clean源xyz尺寸[.131833822,.218673587,.547052264]；米制min[-.036148417,0,-.059959606]、
max[.036148417,.30,.059959606]，尺寸[.072296833,.30,.119919211]。
0.30m为人工声明的模拟尺度，非数据集实测物理高度。
完整源场景min[-1.712221146,-.332890719,-1.393499851]、max[1.576694369,1.927182198,.941811204]；
米制min[-.733387476,-.548415262,-.599423143]、max[1.070232980,.732254543,.639986543]。
前景米制高度范围[0,.305271320]由距离切分产生，没有再次缩放。report.json保留完整三层包围盒、
输入出处/字节数、旋转及尺度声明；高斯中心、轴与样本共同变换。

#### up核对

实际重算181帧全部矩阵合法，projected-world-up长度>=.5的有效帧181，无不确定帧。
最大原角23.266398754°在frame_00172；最大投影角15.814266747°在frame_00175（长度.982852483）。
采用20°留约4.19°捕获滚转余量，未复制55°、未改世界轴、未按角度排除帧。
目视原始frame_00001为电话线正面斜视，frame_00172和frame_00175为带俯视/滚转的局部观察，
墙面、门框、悬垂线与声明转正结果相容。相机图像+Y不是测得重力，所有原角/投影角/有效性
仍保存在报告，零不确定帧不意味着测得物理竖直。

#### 有限r/h校准

| r (m) | 动态/固定高斯 | h=.016固定/可动材料 | h=.012固定/可动材料 |
|---|---|---|---|
| .003 | 35767 / 1860 | 101 / 367 | 178 / 662 |
| .006 | 35951 / 1676 | 82 / 386 | 140 / 700 |
| .009 | 36087 / 1540 | 81 / 387 | 134 / 706 |

两精度材料总数468/840，全部候选无退化；逐点高斯分类跨精度相同。
节点沿用最近前景标签延拓，未将空代理厚度变成固定材料。
`calibration-04/calibration.json`和每候选CSV给出完整数值；`evidence-04/regions.py`生成
上排x/y全线、下排z/y顶部.23–.31m局部图（红固定/绿可动）。目视三个候选的螺旋线主体均绿，
两端顶部保留红色小固定区，增大r逐渐吞掉与线相邻的固定边缘。选择最小已测r=.003m保留
这个小区域：主体没有大片错误固定的证据，无需扩大容差。h=.016用于当前运行，.012做对照。
固定高斯只占约4.94%，但固定代理节点约21.58%；厚代理的最近标签延拓不保持高斯数量比例，
不能据此宣称固定体积已物理标定。不追加第二半径、裁剪或人为固定点，也不宣称r唯一最优。
maxStretch1.05、damping2/s、柔抓.003s是初始交互声明，非电话线材料实验参数。

#### GPU smoke与复现

```sh
node tools/prepare-physdreamer.js --scene telephone --input /home/liaowanjun/Datas/physDreamer/physics_dreamer/physics_dreamer/telephone --camera-convention opengl-c2w
node tools/calibrate-physdreamer.js --scene telephone --input public/splats/telephone --input-kind real --r=0.003,0.006,0.009 --element-sizes=0.016,0.012 --output public/splats/telephone/calibration-04
npm run dev -- --host 127.0.0.1 --port 5191
VK_DRIVER_FILES=/usr/share/vulkan/icd.d/intel_icd.json google-chrome --user-data-dir=/tmp/physdreamer04-chrome --remote-debugging-port=9355 --no-first-run --no-default-browser-check --disable-extensions --enable-unsafe-webgpu --enable-features=Vulkan --use-angle=vulkan --enable-logging=stderr about:blank
node public/splats/telephone/evidence-04/smoke.mjs
node public/splats/telephone/evidence-04/views.mjs
python3 public/splats/telephone/evidence-04/regions.py
```

校准复跑换新目录。正式入口 `http://127.0.0.1:5191/?scene=telephone`，Chrome153.0.8010.47，
ANGLE Intel UHD770 ADL-S GT1/Mesa25.2.8 Vulkan，实际WebGPU解算与绘制，没有替代生产路径。
smoke脚本复用前票结构并换场景/端口，调用实际sim.grab/moveGrab/releaseGrab完成一次交互，
未模拟DOM鼠标事件。共享输入处理由已有回归覆盖，本票未改UI。默认相机射线瞄向[0,.12,0]，
命中[.024968835,.143291414,.031121908]，16个握持节点且staticHeld为空。
18帧目标横移4cm，最大材料位移.031205172m；松手held=0。拖动及松手30帧后位置全finite，
两阶段固定位移均0。固定前景及背景最终GPU dataTransformA/B四份SHA-256前后相同，
保存在smoke.json，不是只比CPU输入。468材料节点（101静态/367可动）、215格、432接触节点，
分配3500节点不等于材料数。松手短测30帧/3.5082s=8.551394fps，丢时2.260709393s。
smoke页面唯一错误favicon404，没有页面异常或WebGPU验证错误。关闭局部截图页时Chrome stderr
另有一条SharedImageManager::ProduceSkia不存在mailbox的浏览器合成错误；截图已取得，未见
设备丢失或模拟异常，不将其隐去。60fps/零丢时未达，按本轮契约不阻止交付。
未提高24步上限、修改清洗阈值或省略背景来刷帧率，未重跑旧08矩阵。

目视smoke.png为默认全景：电话、螺旋线、墙面开关、恒温器及白板场景完整可辨；
front.png/front-wire.png为实际共同变换后的frame1相机位置[-.146958442,.250730344,.476131372]
看向[0,.15,0]的局部与线框。views仅在证据页暂停模拟、禁用相机脚本改视角，不改生产默认相机。
regions.png是CSV投影证据图，不是编辑生产截图。限制：.016m体积代理显著比螺旋线粗，
不能解析每一圈真实弹簧几何或线圈自接触；大幅拖动、固定边缘接缝与真实材料响应未完全标定。
扫描本身有模糊/缺口；静态墙面没有碰撞支撑语义。暂停视图显示的帧率不能当动态性能结果。

#### 验证和清理

扩展已有it.each(['hat','carnations'])共享注册契约加入telephone，先红（未知入口）后绿；
沿用约定工厂接缝，不复制场景测试。定向alocasia/architecture/docs 3文件35项通过。
全套首次因沙箱spawnSync Node EPERM受阻，提权重跑36文件348项通过；npm run build通过，
仅既有worker_threads外置和bundle大小提示。仓库无typecheck脚本。
文档完成后architecture/docs两文件14项通过，git diff --check通过。
四输入结束SHA-256重验一致，产物和证据确认ignored。任务专用Chrome9355用Browser.close关闭，
Vite5191已停止，未操作用户浏览器。tools/README列出四正式准备命令/入口及alocasia旧命令兼容。
待提交文件为本票、src/scene/physdreamerDeclarations.js、src/scene/scenes.js、
test/unit/alocasia.test.js、tools/README.md。交fresh reviewer，未自行提交。


### 2026-09-22 · 独立审查后文档补修

同步 tools/README.md 开头过期的场景状态：alocasia、hat、carnations、telephone 四场景均已接入，
不再把 carnations、telephone 写作后续票。仅修正文档，与下方四场景命令一致；运行时、参数、
测试代码和GPU证据不变。文档护栏 test/unit/docs.test.js 通过，git diff --check 通过。
未重复GPU或全套测试，未提交。

### 2026-09-22 · Fresh independent code-review 完成

固定基线 `d6e605f7a020bd4142a38fdc91bcea5a0c4fd9ba`，核对完整工作区5文件diff及untracked
（无额外文件）；Standards与Spec分别由独立子reviewer检查，未参与本票实现。

- **Standards：0个未解决finding。** 小声明复用共享工厂，无新目录、依赖边、算法副本或main监听。
  唯一非阻断建议为README开头的旧场景状态；原实施者已补修，reviewer复核与四入口说明一致。
- **Spec：0个实质finding。** 完整背景进入共享清洗，三层语义、ADR-0020标签延拓、r/h有限校准、
  顶部固定区保留、20°投影up依据及真实GPU smoke满足本轮可运行交付契约；先前场景参数未改。
- 独立运行alocasia/architecture/docs定向回归：3文件35项通过；git diff --check通过。
  四个原输入SHA-256、校准引用准备产物哈希匹配，产物ignored。独立重算181帧，181帧有效，
  原角最大23.266399°、投影最大15.814272°，与报告浮点误差内一致。
- 复核真实report/calibration/smoke脚本与JSON、全景/局部线框/分类图片以及最大投影角原图。
  GPU证据使用sim API，未覆盖DOM鼠标事件；review没有重跑GPU或旧08矩阵。
  8.55fps及丢时、粗代理与未标定材料限制继续保留，不把性能目标记为通过。

最后补修仅文档；已复核其变更及最终5文件范围，未扩大全套测试或修改实现。票置resolved，
交root提交；reviewer未commit。
