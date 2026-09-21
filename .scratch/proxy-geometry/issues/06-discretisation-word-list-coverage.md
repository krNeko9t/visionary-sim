# 06 · 离散化词表的覆盖面

Status: resolved
Type: task
Blocked by: 03

## Question

`test/unit/architecture.test.js` 的 `DISCRETISATION` 词表今天只扫 `render/`。要决定它还该覆盖
哪些区域，并**把红的改绿**（使用者已批准为此动 `src/`）。

### 已核实的现状

- 覆盖：只有 `render/`。`deformation/` 被 `RENDERER_API` 反向守着，但**没有**被离散化词表守着
  ——`bind.js` 正大光明地说 lattice。
- 无人看守：`ui/`、`scene/`、`body/`、`main.js`、`sim/grip.js`。
- 显式豁免：`sim/debug/`（「它画格子，这正是它住在 `sim/` 而不是 `render/` 的全部理由」）。
- **今天就红的**：`ui/panel.js`（`onLatticeToggle`、「显示点阵」）、`main.js`
  （`import { createLatticeView }`、`latticeViews`、挂 `window`）。

### 要决定的

1. 词表覆盖哪些区域。`body/` 与 `scene/` 今天应该是绿的（要核实）；`ui/` 与 `main.js` 是红的，
   使用者选了「红了就改」。
2. 词表该含哪些词——这一条**依赖 03 画的线**：`h`、`cellDims` 是点阵专属，该禁；「节点」
   「自由度」是中立的，禁了就是把中立词也判成违规。今天的词表是
   `/\blattice/i, /\bvoxel/i, /\bcell/i, /\btetra/i, /\bdeform[A-Z]/`——注意 `\btetra` 在换成
   四面体网格之后会变成**中立词**，这个词表本身就是「点阵是唯一居民」的化石。
3. 红转绿怎么改：`ui/` 那个开关的标签与回调名要中立化（调试视图画的是「代理几何」，今天恰好
   是格子）；`main.js` 不再直呼其名。`sim/debug/` 内部保持点阵专属，豁免不变。
4. 豁免要写在**正确的位置**并说明理由（照现有测试的文体，注释解释为什么这条缝是对的）。

## 02 的修正与补充（2026-09-20）

- **「无人看守」那一行要加三处**：`sim/simulator.js`（`lattice` 31 次）、`sim/pick.js`（概念层：
  `invMass === 0` 的惰性节点读法）、以及 **`sim/solver/`**——`predict.wgsl:21` 与
  `finalize.wgsl:84` 的注释里都有 `lattice`。`sim/solver/` 这一处特别值得注意：它**已经**被
  `INTERACTION` 词表扫着，但 `DISCRETISATION` 没扫它，所以「这个区域有人看守」是个假象。
- **`deformation/` 比原来记的更糟**：不只是 `bind.js` 说 lattice。`corners.js` 的 `CUBE_CORNERS`
  是一个**点阵常量**住在 channel 里，`sample.js` 的 `LatticeSpace` typedef 带着 `origin`/`h`/
  `cellDims`。词表覆盖 `deformation/` 会红，而红得有道理——见 03。
- **词表不能无脑扩到全仓库**：`sim/state/particles.js:10` 的注释写「It is not a lattice corner」，
  `state.wgsl:7-10` 写「Nothing about cells, colours or lattices appears in this file」。这是
  **反向声明**（宣布自己不知道），扩到这里会误伤，而且会逼人删掉仓库里少数说对了的句子。真正该
  扩的是 `ui/`、`main.js`、`body/`、`scene/` 四处。
- **`render/` 的现有规则是这份审计里唯一发挥了作用的机器检查**（`render/` 判定 A，一行不动）。
  原样保留，不要在重写词表时把它一起动了。
- **`body/` 与 `scene/` 今天不红，但会红**：`softBody.js:38-48` 的 `resolution` 文档写着
  「Cells along the longest axis」，`factory.js` 三处 jsdoc 转述，`scene/` 八个调用点写着
  `resolution: 12 / 8 / 20`。词表里的 `/\bcell/i` 一扩到 `body/` 就会命中那句文档。这不是误伤
  ——那句文档确实是点阵专属的，`resolution` 的**单位**要跟着换。

清单见 [02 · 四面体反事实审计](02-tetrahedral-counterfactual.md)。

## 03 的结论对本票的影响（2026-09-21）

- **豁免区从此只有一个**：`sim/discretize/lattice/`。03 把全部点阵专属收进那个目录（数据、
  采样器、弹性约束、线框几何的构造），所以「哪里允许说 lattice」是一条规则而不是一张清单。
- **`sim/debug/` 那条豁免作废**：03 把线框视图改成一条渲染路径（接口条目 `wireframe()`，画它
  的代码进 `render/`），该目录整个消失。**`main.js` 那处红因此顺带变绿**，不需要为它单独想
  一个中立叫法。
- **`ui/` 那处红照旧要改**（`onLatticeToggle`、「显示点阵」），中立叫法由 03 的条目 5 给出：
  开关说的是「代理几何」，而规模读数的词（「格」）由 `scale()` 自己带出来。
- **时序要注意**：词表一扩到 `deformation/` 当场就红（`bind.js` 说 lattice、`corners.js` 的
  `CUBE_CORNERS`、`sample.js` 的 `LatticeSpace`），但**真正的修法是 03 决定的那次搬家，属于
  09 的 spec，不在本票的「最小改动」额度里**。本票要自己选：临时豁免 `deformation/` 并留一条
  注释说明豁免到哪一步为止，或者把覆盖 `deformation/` 这一条留给 09 那次搬家一起落。
- **`\btetra` 会变中立**这条判断不变，但 03 之后有了更准的说法：换掉的不是词，是**豁免区的
  位置** —— 词表本身可以原样保留，只要说得清哪个目录是唯一的居民。

## 交付

- `test/unit/architecture.test.js` 改动 + 红转绿所需的最小 `src/` 改动，就地落盘。
- 跑一遍测试，红过再绿过——只加规则不验证，等于又一句会过期的承诺。

## Comments

## 04 交来的一个词（2026-09-21）

**`inert` → `inactive`**，随本票那一趟落盘。

- **词已定**：`inactive node` 是共识词（MPM：arXiv:2605.28525 §2.1.1；fictitious domain FEM：
  Court & Fournié, arXiv:1502.03953 §3），`inert` 是仓库自造的。出处见
  [01](01-boundary-condition-vocabulary.md)。
- **是一次纯注释替换**：`inert` 在 `src/` 里没有一个标识符叫这个名字，只出现在注释与 jsdoc——
  `lattice.js:9,16,18,114`、`particles.js:27,28,66,81`、`pick.js:22`、`grip.js:86`、
  `voxelize.js:190`。六个文件里有四个本来就在 02 的清单上。
- **为什么归本票而不是 04**：本图 Notes 给 `src/` 的许可是「护栏红转绿所需的最小改动」，注释
  改名不是红转绿；单独为八处注释再开一次改动是白开。
- **它不进 `CONTEXT.md`**：惰性节点是 4.2 的后果、不是领域概念，理由见
  [ADR-0003](../../../docs/adr/0003-material-inverse-mass-means-inactive-only.md) 末条。

### 05 的结论对本票的影响（2026-09-21）

4.2 那句代价声明被**删除**，不再写成文字（[ADR-0004](../../../docs/adr/0004-architecture-roots-become-adrs.md)）。
它的真相现在**就是本票的词表测试**：「换掉点阵只动 `sim/discretize/lattice/`」要靠「只有那个目录
可以说 lattice」来兑现。所以决定临时豁免哪个区域时，豁免注释要说清它是在掩盖一处**真实的**
代价，而不是误伤。

## Answer

**词表扫全仓库，只有一个居民 `sim/discretize/lattice/`；今天仍在说点阵的 33 个文件逐个列进
`DISCRETISATION_DEBT`，外加一条「债单里的文件已经干净就红」，所以债单只减不增。** 使用者
2026-09-21 在三个选项上都选了推荐项。

### 定下来的

| # | 问题 | 结论 |
|---|---|---|
| 1 | 覆盖哪些区域 | **全部 `src/`**，不枚举。枚举消费方会让 `sim/` 整片无人看守，「只有一个目录说 lattice」今天就无法被检查 |
| 2 | 词表含哪些词 | **原样不动**（`render/` 那条规则也原样保留）。换掉的是豁免区的位置，不是词 |
| 3 | `deformation/` 的时序 | 不需要单独的临时豁免：它的 5 个文件和别的欠账一样进债单，每条写明由 09 的哪一步还 |
| 4 | 豁免写在哪 | 居民是一个常量 `DISCRETISATION_RESIDENT`，它**还不存在**，规则照样对着它写；债单每条带一句理由；注释说明「每一条都是真实代价，不收误伤」 |
| 5 | `sim/state/` 的反向声明 | **改写成不点名的说法**，不给永久豁免。意思不变，`sim/state/` 从此被词表看着 |
| 6 | `/\bcell/` 的中立用法（broadphase 的 hash grid、CFL） | **词表不变，靠债单吸收**：这两个文件本来就因别的点阵依赖在债单上（`h` 推出的桶上界、`cflLength`）。09 搬完若只剩误伤，在那个文件里把 grid cell 改叫 bucket |

### 实测与票面不符的两处

- **`body/` 与 `scene/` 今天就是红的**，不是绿的。`scene/` 三个文件按「N mm cells」调参，
  `body/material.js` 的稳定性论证按单元说、还引用 `cells.wgsl` 的路径——都是真实代价
  （`resolution` 的单位），不是最小改动能修的，进债单。`softBody.js` 只剩一句反向声明，已改写。
- **`/\bdeform[A-Z]/` 在 `deformation/` 里面是误伤**：`covariance.wgsl` 头注释说「every name
  introduced here begins `deform`」，那是通道自己的命名空间。所以这一条模式在 `deformation/`
  内不生效，理由写在 `discretisationIn()` 旁边；在 `deformation/` 外它照旧抓「有人在读通道的
  内部名字」。

### 落盘

- `test/unit/architecture.test.js`：`DISCRETISATION_RESIDENT`、`DISCRETISATION_DEBT`（33 条，
  分四组：整份搬进居民 / 留下但改走中立接口 / `resolution` 的单位 / 下游的散文）、
  `discretisationIn()`、两条新测试。`ALLOWED` 未动，所以不需要 ADR。
- `src/`（全是注释与一个回调名）：
  - `inert` → `inactive`：`lattice.js`×4、`voxelize.js`、`particles.js`×3、`grip.js`。
  - **三处 `inert` 没有照改**：`particles.js:81`、`predict.wgsl:21`、`finalize.wgsl:51` 的 `inert`
    指的是「此刻不被解算」（惰性**或**被规定），照改成 `inactive` 就违反 ADR-0003。改写成两者
    并列的说法，顺带去掉了 `sim/solver/wgsl/` 里的 `lattice`/`cell`——那两个 shader 不进债单。
  - `sim/state/particles.js`、`state.wgsl`、`body/softBody.js` 的反向声明改写。
  - `ui/panel.js` + `main.js`：`onLatticeToggle` → `onProxyToggle`，「显示点阵」→「显示代理
    几何」，一处注释。**`panel.js` 仍在债单上**：规模读数读 `cells`，要等 `scale()`。
- `ARCHITECTURE.md` §五：加一行护栏。

### 验证

- 撤掉 `src/` 改动跑：新测试红，10 处（`sim/state` ×2 文件、`sim/solver/wgsl` ×2、`softBody.js`）。
- 往债单塞一个干净文件（`sim/pick.js`）：「已还清的债」那条红。
- 全部 `src/` 改动就位：26 个文件 232 条全绿。

### 交给别人的

- **09**：债单就是那份 spec 的验收清单——spec 走完，`DISCRETISATION_DEBT` 应当为空、可以删掉
  那条常量。另外 `render/` 那条测试的注释还写着 `sim/debug/` 的豁免理由，随 `sim/debug/` 消失
  一起改。见 09 的评论。
