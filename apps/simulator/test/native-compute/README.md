# 原生计算关卡

`page.js` 在实验应用创建的同一个原生 GPUDevice 上构造模拟器，但不启动宿主帧循环。
它通过模拟器公开方法验证单步自由落体的已知位移、两种驱动律、弹性及拉伸限制派发、
重叠物体接触、精确重置、连续三次创建销毁和销毁后宿主 device 仍可使用。
所有计算 kernel 都在这些路径中编译并实际派发；校验错误和未捕获错误使测试失败。

从 editor 根目录按正式 4090 跑法运行（不需要外部资产）：

```bash
node scripts/browser-4090/run.mjs --ref HEAD \
  --project deps/visionary-sim/apps/simulator \
  --install 'npm ci --prefix deps/visionary-sim' \
  --page /test/native-compute/page.html \
  --test 'node test/native-compute/run.mjs --base {base} --cdp {cdp} --output {output}/native-compute' \
  --output target/browser-4090/native-compute
```

这条合成关卡不能替代 `motion-reference/` 的三个旧场景零容差比对、`native-buffer/`
的宿主绘制与排序冒烟，或 `alocasia-drag-run.mjs` 的真实资产抓取回归。完整验收还须运行它们。

后端单元测试用伪造 device 验证参数字节布局、绑定类型与槽位、跨工作组输出和读回值，
以及映射失败清理；已有物理/场景单元测试通过私有伪造计算后端保留原有行为断言。
