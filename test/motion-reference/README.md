# 运动参考：改写前录下、改写后必须复现

在旧实现（借用 PlayCanvas 的缓冲与派发、WGSL 方言）上，让几个现有场景经模拟器的公开方法各走固定步数，把全部节点位置录下来入库。模拟改成只依赖 WebGPU 之后（首次接入 S2），同一组场景必须复现这份结果。

"能编译、能派发"抓不到缓冲绑错槽、uniform 打包错位这类错误，按节点位置比对能抓到。

浏览器关卡以 Windows RTX 4090 为准，经 visionary-editor 的 4090 跑法运行（editor 仓库 `docs/browser-tests-on-4090.md`）。`npm run check` 只跑这里的纯函数单元测试 `test/unit/motionReference.test.js`。

## 文件

| 文件 | 作用 |
|---|---|
| `scenarios.js` | 录哪些场景、每个场景做什么、在哪几步读节点位置 |
| `simulatorAdapter.js` | 本测试唯一碰模拟器的地方：建模拟器、走步、抓取、读节点位置。模拟器公开接口改了，只改这个文件 |
| `page.html`、`page.js` | 浏览器一侧：在真实 WebGPU 上按脚本播放一个场景 |
| `reference.js` | 纯函数：由重复运行定容差、拿一次运行与参考比对，失败信息写明下一步 |
| `run.mjs` | Node 一侧：经 DevTools 协议驱动独立的 Chrome，比对或录制 |
| `recorded/` | 入库的参考结果：`conditions.json` 记录制条件，每个场景一个 JSON |

## 场景

| 场景 | 覆盖什么 | 步长 dt | 节点数 | 读节点位置的步数 |
|---|---|---|---|---|
| `tank` | 两个网格、三个解析形状在重力下落进水箱、互相碰撞：网格与解析形状的离散化、弹性、物体间接触（含 `atomicAdd` 分桶）、边界 | 0.722 ms | 14104 | 0、480、960、1440（约 1.04 s） |
| `splats-contact` | 面包落在毛绒玩具上：高斯云的体积、云与云的接触 | 1.955 ms | 8160 | 0、240、480、960（约 1.88 s） |
| `alocasia` | 无重力的扫描植物，叶子被拉 4 cm 后松手（同 `alocasia-drag` 回归的修正后用例）：静态规定、拉伸上限、柔顺驱动 | 0.748 ms | 16704 | 0、536（拖完 0.4 s）、804（再保持 0.2 s）、1472（松手 0.5 s） |

`tank` 只用入库的 OBJ。另两个要真实 3DGS 资产：`public/splats/bread.ply`、`public/splats/wolf.ply`，`public/splats/alocasia/` 下的 `foreground.ply`、`background.ply`、`moving_part_points.ply`。每帧至多走 24 步，与应用相同；抓取目标每帧移动一次，所以分批也是脚本的一部分。

## 录制条件与容差

`recorded/conditions.json` 记下录制所在的 sim 提交、Chrome 版本、GPU 与驱动、重复次数、容差规则，以及 `public/` 下每个资产文件的 SHA-256。每个场景的 JSON 记下脚本、每帧步数上限、步长 dt、节点数，以及每个检查点的 `spread`（重复运行偏离第一次的最大距离）和 `tolerance`。

容差的定法：录制时用同一实现把每个场景重复跑几次，以第一次为参考；每个检查点允许重复运行中最大偏离的两倍。

**实测结果：容差为 0，比对是逐位精确的。**2026-10-14 在 4090 上录制时，三个场景各重复 5 次，每个检查点的全部节点都逐位相同，`spread` 全为 0。接触分桶的 `atomicAdd` 到达顺序确实不固定，但紧接着的 `sort.wgsl` 把每个桶整理成固定顺序（见那个文件的注释），所以同一实现、同一环境下的结果是确定的。改写后必须在同一环境里逐位复现。

偏离多大算什么，以下实测可作判断依据（`tank`，最大节点偏离，依次为第 480、960、1440 步）：

| 改动 | 偏离 |
|---|---|
| 重力改动 f32 的 1 个 ulp（−9.81 → −9.810001），本机 Intel | 0.0034 mm、0.12 mm、0.18 mm |
| 同一提交换一块 GPU（本机 Intel 对 4090） | 0.098 mm、1.5 mm、2.1 mm |
| 重力改 0.1%（−9.81 → −9.80），本机 Intel | 0.98 mm、2.4 mm、6.9 mm |

浮点层面的差别会被接触放大，越往后越大，所以早的检查点最能分辨"只差舍入"和"真的改了什么"。换了 GPU 或着色器编译器，偏离可以和一个真实的小改动一样大，这是参考结果只对录制环境成立的原因。

## 运行

在 editor 根目录执行，`--output` 必须是尚不存在的新目录。真实 3DGS 资产不在 Git 里，用 `--asset` 带入，必须与 `recorded/conditions.json` 里的 SHA-256 相同。

比对（`splats` 指向本机放资产的目录）：

```bash
splats=/path/to/splats
node scripts/browser-4090/run.mjs \
  --ref HEAD \
  --project deps/visionary-sim \
  --install 'npm ci --prefix deps/visionary-sim' \
  --asset "$splats/bread.ply=deps/visionary-sim/public/splats/bread.ply" \
  --asset "$splats/wolf.ply=deps/visionary-sim/public/splats/wolf.ply" \
  --asset "$splats/alocasia/foreground.ply=deps/visionary-sim/public/splats/alocasia/foreground.ply" \
  --asset "$splats/alocasia/background.ply=deps/visionary-sim/public/splats/alocasia/background.ply" \
  --asset "$splats/alocasia/moving_part_points.ply=deps/visionary-sim/public/splats/alocasia/moving_part_points.ply" \
  --test 'node test/motion-reference/run.mjs --base {base} --cdp {cdp} --output {output}/motion-reference' \
  --output target/browser-4090/motion-reference
```

- 全部通过时退出 0，打印 `PASS`；`{output}/motion-reference/comparison.json` 记下每个检查点的最大偏离、对应节点和两边的条件。
- 未提交的改动加 `--worktree`。只跑某个场景，在测试命令里加 `--scenario tank`，可重复。
- 录制：测试命令换成 `node test/motion-reference/run.mjs --base {base} --cdp {cdp} --output {output}/motion-reference --record --commit <sim 提交>`，默认每个场景重复 5 次（`--repeats`）。输出目录里的文件整体替换 `recorded/`。
- 在别的机器上也能跑（默认连 `127.0.0.1:5188` 的 Vite 和 `127.0.0.1:9351` 的 Chrome，同 `test/alocasia-drag.md`），但参考结果只对录制时的 GPU、驱动和浏览器成立。

## When it fails（失败时怎么办）

失败信息逐条写明是哪一类。按顺序排查：

1. **资产不是录制时那份**：补上 SHA-256 相同的文件。输入不同，比对没有意义。
2. **`scenarios.js` 不再播放录下的内容**：改场景就要在旧实现上重录（见下文"重录"），与修改放在同一个变更里。
3. **节点数或步长 dt 不同**：这两样在 GPU 走第一步之前就由 CPU 决定（离散化、材料、CFL），任何 GPU 后端都改变不了它们。先找出是哪处 CPU 代码改了。
   - S2 第 3 步把高斯云的输入改为协方差，并加薄高斯防护。这会改变 `splats-contact` 和 `alocasia` 的体素化，于是节点集合可能不同，逐节点比对就失去意义；`tank` 只有网格和解析形状，不受影响。所以 GPU 后端的改写（S2 第 2 步）要在改协方差之前比对完；改协方差之后这两个场景要怎样验收，由 S2 开工时与用户商定。
4. **某个检查点的节点偏离超出容差**：
   - 先看失败信息末尾有没有"浏览器或驱动不是录制时那个"。如果有，换了着色器编译器本身就可能挪动结果：先在 `conditions.json` 记下的提交上用当前浏览器重录一份放到别处，与入库的那份比对，分清是环境还是改动。
   - 环境相同，就是改动改变了运动。找最早失败的那个检查点，`comparison.json` 里有每个检查点的最大偏离和节点编号，对照上文"录制条件与容差"里的实测量级判断：缓冲绑错槽、uniform 错位一般在第一个检查点就偏出厘米级或出现非有限值；只差浮点舍入的改动在第一个检查点只有微米级，之后才因接触放大。只差舍入时是否接受，由用户决定，不要为了通过而放宽容差。

## 重录

参考结果只代表录制时那一个提交的行为。以下情况在旧实现上重录，并在提交说明里写清原因：改了 `scenarios.js`；换了资产；有意改变了物理行为。重录用 `--record --commit <当前 sim 提交>`，把输出目录里的文件整体替换 `recorded/`。
