# 纯前端场景准备与本地恢复：能力调查

日期：2026-09-09。对应「纯前端准备与本地恢复有哪些实际能力和限制」。本文记录事实、源码观察和据此得到的候选路线，不决定浏览器支持范围、依赖或产品交互。

## 结论及边界

已有 PLY、NPZ、JSON 的读取、数值转换、实例索引和本地保存存在纯浏览器实现路线：用户授予文件访问，Worker 做 CPU 准备，TypedArray 交给现有应用。文件读取不需要运行上游 Python。这个可行性是由下述 API 能力和本仓库源码推得的，**没有对给定完整场景进行浏览器端实测，也没有证明它已经能在当前渲染器中正确显示**。

网页及其脚本可由静态 HTTPS 站点提供；数据通过 File API 读取的路线没有上传步骤。静态资源下载与应用后台计算是两回事。实际实现须审计 fetch、遥测、第三方脚本与错误上报，才能验证“场景数据没有离开设备”；API 本身不会替应用保证隐私。这里没有启动服务器或安装依赖。[File API](https://www.w3.org/TR/FileAPI/)

## 选择文件与重开

- `<input type="file" multiple>` 返回用户选择的 File；保存绝对路径字符串不能恢复读取权，表单值也不暴露真实完整路径。源 PLY 和结果目录位于不同地方，可以分次选入。文件选择本身不等于提交表单或上传。[HTML 文件选择规范](https://html.spec.whatwg.org/multipage/input.html#file-upload-state-(type=file))
- `webkitdirectory` 选择目录树后，文件具有相对于所选目录的路径，适合构建 manifest 引用表；它不同于一个可在下次会话重新枚举的目录句柄。文件名冲突不能只按 basename 匹配。[目录选择与相对路径规范](https://wicg.github.io/entries-api/#dom-htmlinputelement-webkitdirectory)
- `showOpenFilePicker` / `showDirectoryPicker` 可返回句柄；要求安全上下文、用户手势并须特性检测。句柄能存 IndexedDB，但下次读取应 queryPermission，必要时重新 requestPermission；撤权、文件移动或消失都需要恢复入口。该能力不能完整 polyfill；Chrome 官方给出的回退是文件 input、目录 input、下载链接。不能将增强句柄路线默认为所有浏览器具备。[Chrome 官方 File System Access 文档](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)

**推论**：跨会话“恢复配置”和“重新获得源文件”必须独立处理。普通 File 选择路线可提示重选并验证身份；存入浏览器的源字节副本能减少重选，但产生额外磁盘占用。配置导出中的文件引用应是可重关联的描述，不是假定可访问的 Linux 路径。

## 解码与 Worker 路线

本仓库直接依赖仅有 PlayCanvas、lil-gui；没有声明 NPZ/NPY/ZIP 解码依赖。[package.json](../../package.json)

| 输入 | 已有能力、限制与可调查路线 |
|---|---|
| PLY | `readPly(ArrayBuffer, {properties})` 无 DOM 依赖，可复用到 Worker；现为整文件 buffer，支持 binary little-endian 1.0，将保留属性全部转 Float32，首元素不能有 list 属性。它不是通用 PLY 读取器。[源码](../../src/assets/splats/ply.js) |
| Gaussian 语义 | `cloudFromPly` 分配规范数组，要求三个 scale 属性、四元数和 DC 色彩；高阶 SH 不保留。Worker 迁移不解决上游两个 scale 的语义差异；源数据契约票须给出答案。[源码](../../src/assets/splats/cloud.js) |
| NPZ / NPY | NPZ 是 ZIP 包含多个 NPY；NPY header 有版本、dtype、shape、Fortran 顺序，header 不是 JSON。非 object 数据为连续字节；object 数组为 Python pickle。可针对上游实际 dtype 实现受限解码，未知类型明确拒绝，不执行 pickle 或 eval。还需校验大小、端序、64 位整数范围、数组形状及索引范围。[NumPy 官方格式](https://numpy.org/doc/stable/reference/generated/numpy.lib.format.html) |
| ZIP 解包 | 原生 `DecompressionStream('deflate-raw')` 可做条目解压，但不解析 ZIP 目录、条目边界或 ZIP64，因此不能把整个 NPZ 直接交给它。[Compression Standard](https://compression.spec.whatwg.org/) 第三方候选 fflate 作者提供 ZIP、同步/异步及流式接口；这是可评估路线，未安装、未选型，也未验证实际 NPZ/ZIP64 能力。[作者仓库](https://github.com/101arrowz/fflate) |
| JSON | File.text 后 JSON.parse 可以在 Worker 中运行；语法解析外仍需应用 schema 校验、单位和实例 ID 关联，不能只相信文件扩展名。[File 文本读取](https://www.w3.org/TR/FileAPI/#dom-blob-text) |

File/Blob 可以序列化到 Worker，由 Worker 读取；最终数组通过 postMessage 的 transfer list 转移其底层 ArrayBuffer。转移后发送端 buffer 被 detach，所有共享同一 buffer 的视图受影响，不能继续使用；这减少跨线程复制，但不会减少算法自己创建的数组。[File 序列化](https://www.w3.org/TR/FileAPI/)、[HTML 转移规则](https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializewithtransfer)

Worker.terminate 可以终止正在进行的任务；普通“取消”消息只能在事件循环获得执行机会后处理，不能即时中断一段长同步解析。候选调度方式是一个准备任务一个 Worker，或分块处理并检查任务代号；迟到结果不应用到新场景。终止不等于回滚已写缓存，缓存应在完成后才发布完成标记。这是依据 Worker 运行与终止语义的设计推论。[Worker 规范](https://html.spec.whatwg.org/multipage/workers.html#dom-worker-terminate)

## 配置、缓存与持久性

IndexedDB 可存结构化记录，适合配置、版本、索引及句柄；OPFS 是 origin 私有文件空间，可存派生二进制，不能按其路径当成普通用户目录。OPFS 的同步文件访问句柄在 Dedicated Worker 中提供，须处理锁定与关闭。[IndexedDB 规范](https://w3c.github.io/IndexedDB/)、[File System Standard](https://fs.spec.whatwg.org/)

浏览器存储按 origin 分隔；换域名或端口不是同一份缓存。`navigator.storage.estimate()` 是估计，不能作为写入成功保证；`persist()` 有授权结果，best-effort 数据会受到存储压力淘汰，持久存储仍允许用户明确清除。配额错误应转成可继续的无缓存路线，不将缓存当成唯一配置备份。[Storage Standard](https://storage.spec.whatwg.org/)

配置可以 Blob＋下载链接导出，也可在支持的浏览器选择保存文件；下载路线不能保证覆盖原文件。[Chrome 导出回退说明](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access#polyfilling) **推论**：最小配置导出可不带源数据；便携完整包需另定义体积、内容与源数据复制行为。配置的版本号、源身份校验和派生缓存的转换版本键是待决定事项。

## WebGPU 与内存：只做静态判断

官方 2025-11-25 公告已经确认 Chrome、Edge、Firefox、Safari 有 WebGPU 实现，不能再笼统称其为 Chromium 专属；具体操作系统、驱动和设备仍有限制。[Google 浏览器状态公告](https://web.dev/blog/webgpu-supported-major-browsers?hl=en) Safari 26 也有厂商发布记录。[WebKit Safari 26](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)

本项目 `createGraphicsDevice` 指定 WebGPU，且形变使用 WGSL；研究没有验证 PlayCanvas 路径在所有 WebGPU 实现上的兼容性。[应用初始化](../../src/scene/app.js)、[splat 渲染](../../src/render/splats.js)

WebGPU 在安全上下文暴露，adapter 获取可以失败；应检查实际 adapter/device 的 features 与 limits。`maxBufferSize` 限制单 buffer，`maxStorageBufferBindingSize` 限制单 storage binding，二者不代表可用总显存；分配失败和 device lost 都有对应 API。不能用“浏览器支持 WebGPU”推导百万 splat 可运行。[WebGPU 工作组规范源码](https://raw.githubusercontent.com/gpuweb/gpuweb/main/spec/index.bs)

静态数组成本由本仓库源码可直接计算：规范 cloud 每高斯 14 个 Float32（position 3、rotation 4、scale 3、opacity 1、color 3），即 `56 × N` 字节；保留的 PLY 14 属性又为 `56 × N`；`splatData` 重新拆列再分配 `56 × N`。三者是否同时存活取决于调用生命周期，不能机械相加后宣称总峰值。[cloud 分配](../../src/assets/splats/cloud.js)、[PLY 分配](../../src/assets/splats/ply.js)、[渲染适配分配](../../src/render/splats.js)

仅作算术示例：若 N 最终核实为 1,045,236，一份规范 cloud 为 58,533,216 字节，约 55.82 MiB。此数不包括原始 PLY、NPZ 解压、标签、索引、实例子集、PlayCanvas 资源/排序/work buffers、GPU 纹理、模拟网格、临时复制或运行时开销；它也不是对给定输入的测量结果。未来应分别记录准备阶段 CPU 峰值、上传阶段峰值、GPU 分配、首次可交互时间及每个模拟体的增量，不在本研究承诺时间、帧率或设备最低内存。

## 仍需决策或验证

1. 浏览器/平台支持范围，以及缺少增强文件句柄时的重新选择体验。
2. 源文件身份匹配规则、NPY 支持 dtype、ZIP64 与压缩方式范围；先以真实上游内容约束。
3. 两个 scale 的表示语义与当前 3DGS 契约如何衔接，高阶 SH 是否影响接受标准。
4. 缓存是否复制源数据、何时导出配置、缓存失效及配额不足交互。
5. 准备任务粒度、取消和失败的原子性，之后用原型实测场景资源成本。

以上均未作为产品决策关闭。研究只完成了纯浏览器能力边界调查。
