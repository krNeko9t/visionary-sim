# 05 · 线框成为一条渲染路径

Status: ready-for-agent
Type: task
Blocked by: 01, 04

来源：[spec](../../proxy-geometry/spec.md)「第 5 步」；决定见 proxy-geometry 的 issue 11（`ARCHITECTURE.md` 的对应文字已改好，不用再动 §三/§四）。

## What to build

线框只是又一份被形变带动的几何：静止位置就是节点，图元是线段。`render/` 按**图元种类**
（三角形、高斯、线段）派发画法，不知道几何来自物体还是代理几何；入口把 `wireframe()` 当纯数据
交进去，`render/` 不 import `sim/`。`sim/debug/` 目录消失。

## Acceptance criteria

- [ ] 线框画法住在 `render/`，只认 `DeformationField` 与 `wireframe()`；线框视图在应用里照常显示
- [ ] `sim/debug/` 删除；`ALLOWED` 与 §二 删掉对应行
- [ ] `architecture.test.js` 里 `render/` 词表测试的注释删掉为 `sim/debug/` 写的豁免理由
- [ ] `renderPaths.test.js`：「每种声明的 kind 都有 `VIEWS` 项」改成「凡是会被交出来的几何的图元种类
      都有画法」（`RenderGeometry` 与 `wireframe()` 一起算）；删网格组与高斯组互不 import 那条；
      GPU sorter 那条不动；文件头去掉「两种表示法」
- [ ] 债单删 `sim/debug/latticeView.js`
- [ ] `npm test` 全绿
