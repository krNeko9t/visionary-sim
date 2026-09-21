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
所以 `transform_matrix` 第二列是世界 up。逐帧核对其与源 +Z 的夹角，以最大值判定；
矩阵必须为有限、正交、右手刚体变换。阈值须显式声明，示例 15° 不是实测校准。
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
这些坐标已是世界米制，运行时不能再次 place/normalize。背景仅留档，不加载。
`report.json` 与 stdout 同内容，记录共同变换、逐帧角度、阈值、包围盒和数量。
报告 room 是完整场景中心包围盒，background 是切分后的背景中心包围盒；均不含椭球外沿。

输出目录为本命令的产物目录，不应指向输入目录或通过符号链接指向输入。
重跑开始先删除 report，使旧成功标记失效，再删除三个命名 PLY；不删除其他文件。
单个产物删除失败时继续清理其余产物，最后报告首个真实错误；意外同名目录不递归删除。
全部文件先写临时子目录再发布，report 最后发布；异常时清除四个产物及临时目录。
意外进程终止可能留下临时目录或不完整文件，只有 report 存在才代表完整发布。
输入文件应在命令运行期间保持不变。产物全部被 git 忽略。

所有本轮测试均为临时合成数据。真实相机约定、尺度、前景阈值和可动 r 的复核留给第 07 票。

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
