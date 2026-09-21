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
