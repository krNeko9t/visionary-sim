# 架构

这份文档只描述仓库**现在**是什么样。被推翻的方案与其理由在 `docs/adr/`（2026-09-21 之前的在
封存的 `DECISIONS.md`），正在做的事在 `STATUS.md`；两者都不许写进这里。

§一到§三是结构。可以换掉的选择各是一条 ADR，不写在这里；换掉其中任何一条，前三节不动——
动了，说明它不是选择而是结构，该写回这里。按地基往上的顺序读：

1. 渲染与场景交给 PlayCanvas，物理是 WebGPU 上的 WGSL compute（ADR-0009）
2. XPBD 子步 + 稳定 Neo-Hookean（ADR-0010），可选材料拉伸限制与扫描标签延拓（ADR-0020）
3. 代理几何是均匀体素点阵（ADR-0005），以及把它从别的模块里隔开的那道缝（ADR-0006、ADR-0007）
4. 接触是边界节点上的球并集（ADR-0008）
5. 抓的是一团世界空间里的材料（ADR-0011）
6. 被规定的自由度与材料逆质量（ADR-0002、ADR-0003）

只对打开某一个模块的人有用的细节——某个选择逼出的局部后果、某个常数的推导、某处已知的
粗糙——写在那个模块的代码旁边（ADR-0004）。

## 一、目的

**3DGS 的物理模拟与交互。**

其余各层都是达成它的手段。三角网格与 3DGS 走同一条通路：一份扫描既是画的东西，也是求解器
据以推断体积的东西。

## 二、目录

每个目录承担一个**关注点**，名字取自关注点而不是取自实现，所以更换算法时目录结构不变。

这张表与两个 workspace 的源码及应用离线工具目录由 `test/unit/docs.test.js` 双向核对：表里写着的目录必须存在，
存在的目录必须在表里。读这张表因此等于读那棵树，不需要信任谁记得更新它。

| 目录 | 承担 |
|---|---|
| `apps/simulator/tools/` | 离线资产准备与校准报告；通过共享准备、代理几何与材料计数接口输出资产和分类证据，不被运行时代码引用 |
| `apps/simulator/src/main.js` | 组装：把各层接成一个可运行的程序 |
| `apps/simulator/src/assets/` | 几何进入系统的入口 |
| `apps/simulator/src/assets/splats/` | 3DGS 那道门：容器、解激活、清洗、量、摆 |
| `packages/visionary-sim/src/body/` | 被模拟对象的自我描述：身份、材质、静止形状、可选静态区域。要解算的那份几何与要画的那份分开写——网格物体两者重合，扫描物体不重合 |
| `apps/simulator/src/scene/` | 这一次跑什么、在什么环境里观察它：边界在哪、里面有什么、周围画什么 |
| `packages/visionary-sim/src/sim/` | 模拟侧。`simulator.js` 是对外唯一入口，也是下面四段的装配处 |
| `packages/visionary-sim/src/sim/discretize/` | 把物体变成有限个自由度。来源有三种：解析形状、三角网格、高斯点云。对外只交出中立的 `ProxyGeometry`（条目与不变量写在 `proxyGeometry.js`），外加它自己造的弹性约束：单元是什么、怎样分批，是离散化的知识 |
| `packages/visionary-sim/src/sim/discretize/lattice/` | 代理几何的体素点阵实现。全仓库只有这里可以说点阵的词 |
| `packages/visionary-sim/src/sim/state/` | 那些自由度本身。不知道它们是干什么用的 |
| `packages/visionary-sim/src/sim/constraints/` | 自由度要服从什么：不由离散化决定的约束（接触、`kinematicDrive.js`），以及弹性约束借用的 XPBD 公式（顺服量、本构的 2×2 联立）。一种约束自带它的数据、它的批次规则和它的投影核；看不见离散化 |
| `packages/visionary-sim/src/sim/solver/` | 让它们随时间服从：预测、依次交给每种约束、收尾 |
| `packages/visionary-sim/src/deformation/` | 把求解结果表达为空间形变，任何静止点据此被带动。持有的是契约（`DeformationField` 与 WGSL 的 `deformationAt`），不是实现：采样器由离散化交出 |
| `apps/simulator/src/render/` | 把被形变带动的几何画出来；不知道它从哪来 |
| `apps/simulator/src/ui/` | 把控制权交给人：读出解算状态、改变材料、伸手抓住物体 |

| `apps/simulator/src/body/` | 场景的模拟体工厂：从文件和生成形状组装模拟体 |
| `apps/simulator/src/` | 实验应用源码根目录 |
| `packages/visionary-sim/src/` | 内核源码根目录 |

表中路径相对仓库根目录。根包是私有 npm workspace；`packages/visionary-sim` 是私有包
`visionary-sim`，`apps/simulator` 是私有包 `simulator-app`。应用用包名 import 同仓库源码。
目前 `visionary-sim/*` 子路径按原模块形状开放，公开入口由后续票收紧；PlayCanvas 依赖随旧计算
代码保留到计算后端票。`assets/` 的混合模块仍留在应用，内核临时引用同一份文件，资产准备与
静止几何由票 10 分开。边界审计仍覆盖这些候选文件，原有豁免没有增加或重新划线。

`test/sourceTree.js` 将两个 workspace 的物理路径对应到 S1 的逻辑来源路径，供原依赖表及
只减不增的豁免清单使用；全部内核包源码都会扫描，新目录也不会绕过边界检查。

`wgsl/` 不在表内：那是所在目录的着色器文本，不是另一个关注点。

## 三、结构承诺

两条。它们决定了上表为什么这样分，也是"加一样东西该往哪加"的答案来源。

### 模拟几何与渲染几何分离

物理只演化一套低分辨率的**代理几何**；要显示的东西内嵌其中，被它带动。两个理由长期成立：
省算力；3DGS 是离散点云，只能内嵌。

```
sim/  ──────►  deformation/  ◄──────  render/
```

`deformation/` 规定形变场要回答的两件事：某个静止点现在在哪，它周围的空间被拉成什么样。
后者使网格能求法线、高斯能转协方差，所以一条通道服务所有被带动的几何。通道只持有这份契约，
回答由离散化交出。凡是写成 CPU 与 GPU 两份的数学，前者是后者的参考解，由单元测试对齐。

### 求解器叫不出约束的名字

```
sim/state/  ◄──  sim/constraints/  ◄──  sim/solver/
   自由度            自由度要服从什么         让它随时间服从
```

`sim/state/` 什么都不依赖，只管节点的位置、历史和逆质量。这是允许出现第二种约束的那道缝：
接触与弹性除了"移动同一批节点"之外毫无共同点，于是节点成了两者唯一都能看见的东西，而两者
互相看不见。被规定的自由度也走这道缝：模拟构造时按物体的静态区域采样节点，`sim/state/`
分别保留静态与运动学集合，再与材料逆质量合成求解用的逆质量；它不知道区域如何判断，或
运动学目标由谁提供。静态规定不新增求解器派发约束（ADR-0016）。

`sim/solver/` 看得见 `sim/state/`，**看不见 `sim/constraints/`**。步进器按顺序派发别人交给
它的约束，且必须无法叫出它们的名字——一旦能，"加一种约束"就又变回"改循环"。

推论：**批次规则属于每一种约束自己**。求解框架只按顺序派发，不知道一种约束怎样分批、为什么
批内不冲突；这些随约束的实现而变，写在实现旁边。

## 四、机器验证的边界

写在树上的话必须是真的，所以每条都由测试兑现，而不是由这份文档承诺：

| 保证 | 由谁检查 |
|---|---|
| 谁可以依赖谁、无环、各区域都在 | `test/unit/architecture.test.js` |
| `deformation/` 里不出现渲染器的词汇（**知识边**，import 表看不见） | 同上 |
| `render/` 里不出现离散化的词汇（同上，反向。这条决定体素点阵能不能真的换掉） | 同上 |
| 只有 `sim/discretize/lattice/` 可以说点阵的词，也只有 `sim/discretize/` 可以 import 进那个目录——「换掉点阵只动那个目录与选用它的那一行」 | 同上 |
| 代理几何的接口不变量（含球接触的密封条件） | `packages/visionary-sim/test/unit/proxyGeometry.test.js` |
| 上面§二那张表 ↔ 两个 workspace 的源码与应用 `tools/` 实际目录 | `test/unit/docs.test.js` |
| 越界即塌的两条边界、离散化与点云的封口 | `packages/visionary-sim/test/unit/elastic.test.js`、`apps/simulator/test/unit/shapes.test.js`、`packages/visionary-sim/test/unit/cloudVolume.test.js` |
| 凡是会被交出来的几何都有画法 | `apps/simulator/test/unit/renderPaths.test.js` |
| 形变后的高斯始终走读取 work buffer 的 GPU sorter | 同上 |
| PlayCanvas 原生 device 与缓冲包装的未公开字段只在 `render/playcanvasInterop.js` 使用；含浏览器夹具的其他源码不许分散访问 | `test/unit/playcanvasInteropBoundary.test.js`；真实求值、排序与释放见 `apps/simulator/test/native-buffer/` |
| 渲染帧率只改变固定物理量子的数量，过载不改变步长 | `packages/visionary-sim/test/unit/timestep.test.js`、`packages/visionary-sim/test/unit/simulatorTiming.test.js` |
| 接触桶不受 GPU 原子插入顺序影响 | `packages/visionary-sim/test/unit/contact.test.js` |
| 两种驱动律各自的位移/修正公式；被规定节点在弹性投影里不再分走修正 | `packages/visionary-sim/test/unit/kinematicDrive.test.js`、`packages/visionary-sim/test/unit/elastic.test.js` |
| `sim/state`、`sim/solver` 不出现抓取/指针/拖拽一类的交互词汇（知识边） | `test/unit/architecture.test.js` |
| 抓取集合握住的材料量不随点阵分辨率变化 | `packages/visionary-sim/test/unit/grip.test.js` |
| 将进入 visionary-sim 包的内核源码（`test/kernel-boundary/rules.js` 的 `KERNEL`）只依赖 WebGPU：不 import 包或内核外的文件，不用渲染器 API 和 I/O、页面一类的全局名，WGSL 不写 PlayCanvas 方言；现存违规列在只减不增的 `test/kernel-boundary/exemptions.js` | `test/unit/kernelBoundary.test.js` |

这些约束的**推导写在它约束的那段代码旁边**，不在这里：泊松比下限在 `body/material.js`，
封口宽度在 `sim/discretize/lattice/cloudVolume.js`，填充在 `sim/discretize/lattice/voxelize.js`。文档复述
它们只会得到一份会过期的副本。
