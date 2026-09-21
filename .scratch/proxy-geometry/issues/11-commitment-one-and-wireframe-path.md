# 11 · §三第一条承诺与线框渲染路径

Status: open
Type: grilling
Blocked by: 03, 10

## Question

03 决定把点阵采样器搬出 `deformation/`、把线框调试视图变成一条渲染路径。这两件事各撞坏了
`ARCHITECTURE.md`§三第一条的一段话，要决定它们改成什么。

### 撞坏的两处

**一、「唯一交集」那段论证不再成立。**§三今天写：

> 「形变要交给材质哪几个参数」因此只有一份实现，落在 `deformation/bind.js`。这不是自律的
> 结果：`render/` 只能看见 `deformation/`，`sim/debug/` 只能看见 `sim/discretize/` 与
> `deformation/`，两者唯一的交集就是那里。想各写一份得先破坏分层才拿得到。

采样器搬进 `sim/discretize/lattice/` 之后，`bind.js` 只剩 typedef 与 `COVARIANCE_WGSL`；而
`sim/debug/` 这个目录被 03 删掉了，论证里的第二个前提连主语都没了。保证从**分层强制**降级为
**词表检查**（`DISCRETISATION` 扫 `render/`，豁免区只有 `sim/discretize/lattice/`）。

**二、`render/` 多了一条既不是网格也不是 3DGS 的路径。** 线框画的是**代理几何**，不是被渲染
的那份几何。§三今天说「表示法可以增加，通道只有一条」，`renderPaths.test.js` 兑现「两条渲染
路径并列且互不知情，声明的表示法都已接上」。线框是第三条路径，但它**不是第三种表示法** ——
`?scene=mixed` 那句验收（网格物体与 3DGS 物体同缸共模拟、互相接触）对它没有意义。

### 要决定的

1. 「唯一交集」那段改写成什么。候选：换成词表检查的说法（承认保证换了兑现方式），或者整段
   移出§三（承认它描述的是一个会变的东西）。
2. **「渲染路径」与「表示法」要不要分成两个词。** 今天§三与 `renderPaths.test.js` 混用。若分，
   `CONTEXT.md` 要收哪一个、怎么定义；若不分，线框就得被硬塞进「表示法」，而它接不上 mixed
   那句验收。
3. `renderPaths.test.js` 加不加线框这一行，加的话兑现的是什么（「它只认 `DeformationField`
   与一份静止空间线段几何」？）。
4. §五那张表要不要多一行。

### 与 10 的关系

10 的第 2 问（§三是「不变的部分」，改它算不算破坏它的不变性）是本票第 1 问的前提，所以本票
挂在 10 后面。10 决定那条元问题，本票把结论套到第一条承诺上 —— **同一个元问题不在两张票里
各决定一次**。

## 交付

- `ARCHITECTURE.md`§三（或§五）就地改，`test/unit/renderPaths.test.js` 跟着改。
- 理由写成一条 ADR。
- 不出新的 `src/` 设计：线框路径长什么样已由 03 的接口条目 4 定死。

## Comments
