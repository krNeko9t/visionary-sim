# 06 · 离散化词表的覆盖面

Status: open
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

## 交付

- `test/unit/architecture.test.js` 改动 + 红转绿所需的最小 `src/` 改动，就地落盘。
- 跑一遍测试，红过再绿过——只加规则不验证，等于又一句会过期的承诺。

## Comments
