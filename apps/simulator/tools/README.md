# PhysDreamer 共享工厂

正式命令（Node 24）：

```sh
node tools/prepare-physdreamer.js --scene alocasia --input /path/to/originals \
  --camera-convention opengl-c2w
node tools/calibrate-physdreamer.js --scene alocasia --input public/splats/alocasia \
  --input-kind real --r=0.003,0.006,0.009 --element-sizes=0.016,0.008 \
  --output /tmp/alocasia-new-review
```

第二条仅示范独立候选参数，不批准这些 r，也无需重新校准已接受的 alocasia。
旧 `prepare-alocasia.js` / `calibrate-alocasia.js` 薄转发同一实现，显式参数和默认准备输出路径
保持兼容。通用命令必须提供已声明的 `--scene`；当前 alocasia、hat、carnations、telephone 四场景均已接入。
输出默认为 `public` 加声明的资产根；输入始终只读，衍生产物目录被 git 忽略。

声明集中在 `src/scene/physdreamerDeclarations.js`。运行时 `createPhysDreamerScene(declaration)`
接收 name/assetRoot、米制 r/elementSize、material/grab、显式 requireFixedMaterial；一个场景实例
共享一次 preparation promise，实例之间参数、分类、结果独立。完整清洗前景是唯一模拟源，
动态与固定高斯互斥，背景只绘制；代理标签复用最近前景标签延拓。全动仅在明确声明允许时
通过材料诊断，空材料与无可动材料仍失败。校准共用这些判据和同一公开代理入口。

离线 preparation 声明 heightMetres、foregroundDistanceSource、upMode/upThresholdDegrees/upReason。
0.30 m 是人工模拟尺度，不是数据集真实尺寸。`report.json` schemaVersion=2 记录场景声明、
四原输入的真实路径/SHA-256/字节数、源/米制包围盒、共同变换与相机逐帧证据；最后发布。
运行时仍对三层统一清洗并报告前后计数，prepare PLY 保留原始高斯属性，不做第二次摆放。

相机模式详见 ADR-0021：`camera-up` 保持旧 camera +Y 与源世界 +Z 的原角检查，alocasia 默认
55°不变；`projected-world-up` 检查世界 +Z 在图像平面的投影方向，长度 <0.5 的帧记录为不确定，
不因角度超标排除帧。所有帧必须是合法右手矩阵；至少一帧提供证据，有效帧全部通过阈值。
两模式阈值均为 [0,90)，均不能测得重力或保证未提供证据的俯拍帧竖直。必要时通过
`--up-mode`、`--up-threshold-deg`、`--up-reason` 显式覆盖并在报告记录理由；新场景采用值须经
其原图与有效/不确定帧复核，不仅把 carnations 原始 91.699°放宽为 92°。

# alocasia 离线准备

```sh
node tools/prepare-alocasia.js --input /path/to/originals \
  --camera-convention opengl-c2w --up-threshold-deg 15
```

`--output` 默认 `public/splats/alocasia/`。输入目录包含 `point_cloud.ply`、
`clean_object_points.ply`、`moving_part_points.ply`、`transforms_train.json`。
PLY 使用现有读取器支持的 binary little-endian 1.0、首元素为标量点属性；
样本仅读取 xyz，不需要高斯字段。ASCII/list 属性不支持且会报错。

相机约定必须显式提供：OpenGL/Blender camera-to-world，右手坐标，局部 +Y 是 up，
所以 `transform_matrix` 第二列是相机图像 up 在世界中的方向。逐帧核对其与源 +Z 的夹角，以最大值判定；
矩阵必须为有限、正交、右手刚体变换。省略阈值采用场景声明，示例 15° 不是实测校准。
这是对声明方向的相机证据核对，不是从相机推断真实重力。

clean 全部 xyz 的转正后高度定义 0.30 m（不裁剪、不按最长轴）。应用
`p_world = scale * (x,z,-y) + translation`，clean 底部 y=0、x/z 包围盒中心为零。
高斯四元数左乘同一旋转并单位化，log 尺度加 `log(scale)`；若有完整 normals 也旋转。
所有标量高斯属性保留为 float32，包括当前运行时不使用的高阶 SH；高阶 SH 系数原样保留，
不宣称其方向已旋转，现有 `cloudFromPly` 仅消费 degree-0 色彩。
前景按共同变换后到 clean 样本的距离 <= `0.01 * scale` 分类；这是待真实复核的
前景切分距离，**不是**可动区域容差 r。

输出 `foreground.ply`、`background.ply` 均可由 `readPly` + `cloudFromPly` 读取，
`moving_part_points.ply` 由 `readPly(..., {properties: ['x','y','z']})` 读取。
这些坐标已是世界米制，运行时不能再次 place/normalize。运行时加载背景并仅静态绘制，
不将背景加入模拟源、抓取或接触。
`report.json` 与 stdout 同内容，记录共同变换、逐帧角度、阈值、包围盒和数量。
报告 room 是完整场景中心包围盒，background 是切分后的背景中心包围盒；均不含椭球外沿。

输出目录为本命令的产物目录，不应指向输入目录或通过符号链接指向输入。
重跑开始先删除 report，使旧成功标记失效，再删除三个命名 PLY；不删除其他文件。
单个产物删除失败时继续清理其余产物，最后报告首个真实错误；意外同名目录不递归删除。
全部文件先写临时子目录再发布，report 最后发布；异常时清除四个产物及临时目录。
意外进程终止可能留下临时目录或不完整文件，只有 report 存在才代表完整发布。
输入文件应在命令运行期间保持不变。产物全部被 git 忽略。

工具测试使用临时合成数据；真实资产校准与证据限制见 [07](../physdreamer-alocasia-impl/07-real-asset-calibration.md)。

# alocasia 米制容差对照报告

使用 Node 24（本仓库验证版本 24.15.0），对上一步**已经共同变换**的文件运行：

```sh
node tools/calibrate-alocasia.js --input public/splats/alocasia \
  --input-kind real --r=0.003,0.006,0.009 --element-sizes=0.016,0.008 \
  --output /tmp/alocasia-calibration-01
```

上述 r 仅示范命令格式，**不是校准结果或推荐值**。必须显式提供一组独立米制 r、至少两档
不同的正 elementSize，以及 `--input-kind real` 或 `synthetic`。零 r 合法（仅重合样本可动）。
负值用 `--r=-0.01` 形式传递时可得到数值验证错误；解析命令失败仍在 stdout 输出 JSON 错误。
工具不从旧 h、节点间距或官方阈值推导 r，不读取背景、不再变换或摆放前景。

输入是 `foreground.ply`、`moving_part_points.ply`、准备工具的 `report.json`。
报告保存这三份文件的 SHA-256/字节数、完整准备声明和输入路径；该声明的出处仍需实物复核，
本命令不再次核对相机或证明原始资产实际应用过声明的变换。运行时读取相同 PLY、解激活、统一
清洗、分类函数；节点来自同一个公开离散化入口，材料统计使用运行时的同一纯函数。
输入文件运行期间应保持不变。Node 的 raw 文本钩子仅加载 WGSL 文本，不执行 shader 或访问 GPU。

输出目录必须不存在，父目录须存在；每次使用新的目录，拒绝覆盖旧证据或输入文件。
`calibration.json` 与 stdout 一致，最后写入；只有这个文件存在才代表报告已写完。
中途进程终止可能留下无报告的部分 CSV。退出码 0 表示数值报告生成，2 表示候选出现退化
（保留所有已生成的分类证据），1 表示无效输入/执行错误。三者都**不表示语义校准通过**。
CSV 写入错误会记录在对应精度或输入错误中；缺失证据不能据报告计数当作检查完成。

每个候选有一份 `candidate-N-gaussians.csv`，每档精度有一份
`candidate-N-nodes-K.csv`（仅有材料节点）；清洗后为空则没有节点证据，数量为零、固定比例为 null。
CSV 列为 `id,x,y,z,static,red,green,blue`，所有 xyz 均为共同世界空间米制坐标。
红色为固定、绿色为可动。Gaussian ID 对应清洗后的完整前景顺序；node ID 仅对应该精度的局部节点。
报告逐点重新检查各精度的高斯分类相同，不用数量相同代替分类一致；节点数量可以不同。

复查方式：在支持带 RGB 的 xyz/CSV 点云查看器中（例如 CloudCompare），导入 CSV，跳过首行，
将列 2–4 指定为 X/Y/Z、列 6–8 指定为 RGB；保留相同坐标偏移，叠加对应高斯和节点文件。
分别从正面、侧面、盆沿局部放大查看花盆、盆土、叶片、叶柄，切换候选文件比较边界，记录
候选 r、精度、视角、被误固定/误可动的点 ID 与截图。这是中心分类证据，不描绘椭球边界；
必要时与完整前景高斯查看结果比照辨认细结构。合成点云不能替代真实植物的语义检查。

固定节点比例升高可能表示 r 太小。即使数量健康也不能断言花盆/土固定、叶柄/叶片可动。
若所有候选均无法分离目标，保留 CSV 与视图证据并重开区域决定，不增加第二个半径、
高度裁剪或语义补丁。第 07 票记录真实检查结果后才可落定场景 r。

合成端到端测试（无需真实资产/GPU）：

```sh
npm test -- --run test/unit/calibrateAlocasia.test.js
```

测试在临时目录创建已声明共同坐标的合成高斯、样本与准备报告，覆盖数值、清洗、精度、逐点
证据、重跑确定性、退化和输入错误；明确标记 synthetic，不声称完成真实准备或校准。

# 运行已校准的 alocasia 场景

在仓库根执行；资产已存在时直接启动即可。新 checkout 需先安装依赖（`npm ci`），
再用真实四输入准备资产（产物不入 git）：

```sh
node tools/prepare-alocasia.js --input /path/to/originals \
  --camera-convention opengl-c2w --up-threshold-deg 55
npm run dev -- --host 127.0.0.1 --port 5188
```

支持 WebGPU 的浏览器打开 `http://127.0.0.1:5188/?scene=alocasia`。55° 是 07 中该份
alocasia 资产的相机位姿相容阈值，不是重力精度或其他资产的默认阈值；clean 高度为 0.30 m，
生产 r 已声明为 0.016 m。前景可动部分随物理变形、固定前景和完整背景静态显示。

实现已完成；当前 Intel UHD Graphics 770 的完整负载实测 16.0381 fps、丢时 14.1748948 s，
60 fps / 零丢时未通过，薄结构质量尚未完全确认。设备条件、资产哈希和证据限制见
[08](../physdreamer-alocasia-impl/08-real-gpu-acceptance.md)，不以可运行代替验收通过。


# Hat 真实场景

```sh
node tools/prepare-physdreamer.js --scene hat \
  --input /home/liaowanjun/Datas/physDreamer/physics_dreamer/physics_dreamer/hat \
  --camera-convention opengl-c2w
node tools/calibrate-physdreamer.js --scene hat --input public/splats/hat \
  --input-kind real --r=0.003,0.006,0.009 --element-sizes=0.016,0.012 \
  --output public/splats/hat/calibration-02
npm run dev -- --host 127.0.0.1 --port 5189
```

校准输出必须是不存在的新目录；复跑时换名。浏览器打开
`http://127.0.0.1:5189/?scene=hat`，右键旋转查看帽子正面，勾选“显示代理几何”查看线框，
左键拖动帽体再松手。缺资产会报告 `hat`、具体 URL/HTTP 状态；先运行准备命令。

hat 声明 projected-world-up 25°，207/207 帧有效、投影最大 22.904°、原角最大 38.500°；
原始 frame_00179 为仰视，frame_00001 为常规侧前视。相机观察不能当作重力测量。
clean 高度人为定为 0.30 m，比例 0.572579048559 m/源单位。采用 r=.006 m、elementSize=.016 m，
上方夹持区保留固定材料；maxStretch=1.05、damping=2 /s、柔抓 .003 s 是交互起点声明，
不是针织材料标定。真实清洗后动态/固定前景/背景为 239961/13370/113120。
Intel UHD770 完整负载短 smoke 约 10.80 fps，有丢时；静态 GPU 变换不变，抓取松手均有证据。
当前体积代理不等同于针织薄壳，夹持边界有接缝风险，默认视角较侧、扫描背景存在模糊缺口。
参数对照、哈希、命令及本机 ignored 证据路径见
[02 实施记录](../.scratch/physdreamer-factory/issues/02-hat.md)。

# Carnations 真实场景

```sh
node tools/prepare-physdreamer.js --scene carnations \
  --input /home/liaowanjun/Datas/physDreamer/physics_dreamer/physics_dreamer/carnations \
  --camera-convention opengl-c2w
node tools/calibrate-physdreamer.js --scene carnations --input public/splats/carnations \
  --input-kind real --r=0.003,0.006,0.009 --element-sizes=0.016,0.012 \
  --output public/splats/carnations/calibration-03
npm run dev -- --host 127.0.0.1 --port 5190
```

校准输出需是新目录，复跑时换名。打开 `http://127.0.0.1:5190/?scene=carnations`，
左键抓取花或茎并松手，右键旋转，勾选“显示代理几何”检查线框。缺资产错误包含场景及 URL；
先执行准备命令。三层共用变换与清洗，完整背景不参与材料、接触和抓取。

clean 高度 0.30 m 是人工模拟尺度，比例 .621493461752 m/源单位。场景声明 r=.006 m、
elementSize=.016 m；maxStretch=1.05、damping=2 /s、柔抓 .003 s 为初始交互参数，非植物材料标定。
清洗后动态/固定前景/背景为 75956/5493/305792；固定材料来自真实 clean 距离区域中未匹配 moving
的部分，盆体其余部分仅绘制。细茎体积代理明显比扫描茎粗，不代表植物薄结构已标定。

采用 projected-world-up 55°：209 帧矩阵合法，202 帧可观测、最大投影角50.888°；7 帧投影长度
小于 .5 为不确定，全部原角和不确定理由保留。frame_00052 原角91.699°为强俯拍，不能把原角
阈值改成92°，也不能宣称相机证明世界重力。Intel UHD770 短 smoke 约12.11 fps、有丢时，
固定节点及静态GPU层不变，抓取松手位置有限。60 fps/零丢时目标未过，按本轮契约不阻止交付。
完整参数对照、哈希、截图及命令见 [03 实施记录](../.scratch/physdreamer-factory/issues/03-carnations.md)。

# Telephone 真实场景

```sh
node tools/prepare-physdreamer.js --scene telephone \
  --input /home/liaowanjun/Datas/physDreamer/physics_dreamer/physics_dreamer/telephone \
  --camera-convention opengl-c2w
node tools/calibrate-physdreamer.js --scene telephone --input public/splats/telephone \
  --input-kind real --r=0.003,0.006,0.009 --element-sizes=0.016,0.012 \
  --output public/splats/telephone/calibration-04
npm run dev -- --host 127.0.0.1 --port 5191
```

校准输出需是新目录，复跑时换名。打开 `http://127.0.0.1:5191/?scene=telephone`，
左键抓取电话线并松手，右键旋转，勾选“显示代理几何”检查线框。缺资产错误包含场景及 URL；
先执行准备命令。电话机和房间完整绘制，只有 clean 前景提供物理材料，背景不提供支撑或抓取。

clean 高度 0.30 m 是人工模拟尺度，比例 .548393672095 m/源单位。选 r=.003 m、
elementSize=.016 m；三个小半径和两档精度对照后保留顶部小固定区，未增加人为固定节点。
清洗后动态/固定前景/背景为 35767/1860/271861；材料节点468（固定101、可动367）。
maxStretch=1.05、damping=2 /s、柔抓 .003 s 是初始交互声明，非电话线材料标定。
体积代理明显比螺旋线粗，不能声称已模拟真实弹簧线圈或线圈自接触。

采用 projected-world-up 20°：181/181帧有效，最大投影角15.814°、原角23.266°；
全部原角及零不确定帧统计保留，图像方向证据不等于重力测量。
Intel UHD770 短 smoke 约8.55 fps、丢时2.261s/30帧；抓取松手位置有限、固定节点位移零，
静态GPU层不变。60 fps/零丢时目标未过，按本轮契约不阻止交付。
完整参数、哈希、截图与限制见 [04 实施记录](../.scratch/physdreamer-factory/issues/04-telephone.md)。

四个正式入口为 `?scene=alocasia`、`?scene=hat`、`?scene=carnations`、`?scene=telephone`。
上面的旧 alocasia 准备命令继续兼容；也可使用统一入口：

```sh
node tools/prepare-physdreamer.js --scene alocasia --input /path/to/originals \
  --camera-convention opengl-c2w
```

alocasia 已接受的 r=.016 m、elementSize=.016 m、maxStretch=1.05、damping=2 /s、柔抓 .003 s
及 camera-up 55° 保持不变。所有场景产物和本机证据均位于 ignored 的 `public/splats/NAME`。
