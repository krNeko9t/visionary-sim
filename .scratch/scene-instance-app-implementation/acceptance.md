# 实施验收记录

## 环境与基线（2026-09-09）

- 起始提交：`6c9f5f20109fb2fa4dd9da06743089b043d7e168`；原工作区仅 STATUS.md 已修改，内容为已收束的无人值守评估。
- 服务：本机 Vite，`http://127.0.0.1:5173/`；浏览器为 Codex 右侧内置浏览器。
- 实际打开既有演示：显示“此项目需要 WebGPU / 当前浏览器没有提供 WebGPU 设备”。控制台：`[softbody] fell back to a "webgl2" device`。真实 GPU 验收尚不可执行。
- 浏览器图形诊断页被浏览器 URL 安全策略阻止；未绕过策略。当前未获得浏览器版本或 GPU 适配器信息，不猜测。
- 真实源文件：`/home/liaowanjun/Datas/instascene_preprocessed_data/3dovs/bench/point_cloud.ply`、`/home/liaowanjun/tmp/mx_runs/bench_504x336/labels.npz`、同目录 `instance_physics.json`。

## 输入与 CPU 基线

- 初始 Vitest：26 个文件、230 项通过。
- PLY：321934603 字节，1045236 行，scale_0/scale_1；SHA-256 `91a7f68e28c2b2af0bc5163ca9a74648d48c022dccb518c9222ec40d8ce3834a`。
- NPZ：424438 字节；labels 为 <i4、valid 为 |b1，均一维 1045236；还有 Unicode 标量 params；SHA-256 `d5c011208eaeff82b08df66ee83f377d83534a91886f8f0e7845f0aa44644c79`。
- 物性 JSON：6253 字节，rows 为九条正 ID 记录；SHA-256 `f734f6a07fbf702724cb374a21d9b043bed3c145609f6eb0ab1f6deb06035b1f`。
- 执行主机：Linux 7.0.0-31-generic x86_64；没有 /dev/dri。此信息不代替浏览器宿主或适配器信息。

## 逐票结果

### 01 应用入口

- 实现 agent 报告针对性 6 文件 34 项通过、构建通过；双轴审计进行中。
- 主 agent 真实右侧浏览器重载默认入口：可读错误“当前浏览器无法启动 WebGPU：fell back to a \"webgl2\" device”。该错误分类随后被用户指出不准确，已重新诊断；模拟未验收。
- 主 agent 访问 `?app=missing`：显示“应用启动失败 / no application named \"missing\"; known: demo”，普通入口错误反馈通过。
- 待验证：真实网格/3DGS/混合显示、运行暂停、物性、抓取、敞口边界。

## 主审重点

- 01：启动竞态、部分初始化失败、GPU 异步拾取迟到、重启/销毁事件与资源释放。
- 02：原始行计数早于清洗；额外 NPZ params 不误拒绝；valid=false 与 label0 的显示保留；Worker 取消和候选发布。
- 03/04：SI 原值不截断，缺物性不默认补齐；源参考恒定，切换上轴保留绝对手工配置；球谐方向外观、显示与拾取空间一致。
- 05：二维椭圆片覆盖不能退回零半轴除法；既有敞口与新封闭顶面区分；旋转容器不改变世界重力。
- 06：保持旧体静止参考、速度及小数时钟；应用不搬运粒子；所有改绑成功才释放旧资源；候选失败不双显/消失。
- 07：名单整批开始与返回准备共享语义，尺度改变失效可重建派生结果。
- 08/09：完整字节指纹，改名同内容可恢复，同名异内容不套配置，损坏/错误引用无部分发布；只有存储完成才显示成功。

### 01 双轴审计与返工

#### Standards

- P2：状态监听器抛错可中断启动/清理。主agent用失败回归复现，初始订阅失败撤销注册、通知失败隔离并注销，修复后通过。
- P3（代码气味判断）：表示法分派之外重复判断splats登记资源。主agent改为VIEWS分派直接使用createOwnedSplatView，同一创建入口登记资源。

#### Spec

- P1：Simulator构造中途失败时应用拿不到实例，需内核回滚半成品。已派给05当前内核owner，待验证。
- 背景准备成功后物体准备失败的资源清理已由主agent追加回归、复现并修复；渲染资源构造异常也由02补齐统一销毁。
- 主agent最后针对性复验：4文件14项通过。真实GPU演示回归尚未执行。

### 02 真实输入 CPU 准备

主agent调用正式 `prepareSceneImport` 读取原始三件套：总数1045236、未追踪39528、正ID九个、simulationBodies=0。ID 1–9 计数分别为27402、6847、18876、13434、1025、7581、7840、555810、366893；所有组保留45个f_rest与原始行索引。该检查不证明浏览器显示或三件套同源。

真实反例复验：缺ID1 rho_si、缺ID1整条记录均成功导入1045236/九实例/零模拟体，只有ID1物性无效；重复ID1被拒绝并报重复；n_gau=27403与实际27402矛盾被拒绝并显示两个计数。原始文件未修改，反例只放/tmp/scene-instance-acceptance。

### 08 真实内容指纹 CPU 验证

主agent使用正式fingerprintSourceFiles/matchPreparationSources读取真实bench完整字节，三槽结果与独立Python SHA256一致。三文件改名而内容不变时匹配成功；物性文件同名换为缺rho反例时只报告physics槽内容不同。此为真实文件内容匹配逻辑验证，不代替浏览器下载/重选/重开。

### 正式scene入口

主agent真实右侧打开 `?app=scene`，当时显示回退webgl2；该信息不足以判定根因，见后续启动诊断。无法进入所需GPU显示流程，未声称Worker文件选择或模拟已通过浏览器验收。

### 03 主审接线返工

- 本地PlayCanvas render-pass-picker.js只有enableIds开启时建立GSplat placement→component拾取映射；默认false。03初次实现只构造Picker没有开此选项，主agent补在sceneNavigation挂载/销毁时设置和恢复。真实GPU拾取效果仍未验证。
- 选择/物性独立13项通过；同期应用集成测试因04新增sceneCalibration.js尚未落盘而收集失败，等待04稳定再重验。

### 启动误报诊断与返工（用户反馈后）

- 原始控制台日志（log级别）是PlayCanvas对null adapter读取features的TypeError，原工厂吞掉此异常并继续WebGL2，然后项目统一误报浏览器能力。
- 最小本地HTML不加载应用或PlayCanvas，直接navigator.gpu.requestAdapter：当前右侧浏览器secure=true/gpu=true；无参数、low-power、high-performance、xrCompatible=false均返回null。这个观察不证明其他浏览器或硬件不支持，也未定位浏览器为何不提供adapter。
- 已取消自动回退工厂，直接初始化WebGPU设备。普通引擎失败保留原始异常；adapter明确为null时显示实际观测和发生阶段。3项回归先红后绿，相关12项通过。
- 正式scene入口右侧复验显示“WebGPU requestAdapter 返回 null，未获得适配器；尚未进入渲染或模拟初始化”。误导性的fallback错误不再出现。成功创建WebGPU设备及后续GPU功能仍未验收，不能把文案修正算作渲染启动修复。

### 02 ZIP64 审计返工

Spec P1：NumPy np.savez 的 local ZIP64 大小占位被误拒。02使用真实NumPy存储/压缩字节回归先红后绿，解析64位extra后保留CRC及中央目录一致性校验；相关48项通过。真实bench重跑正式导入成功，证据 /tmp/scene-instance-acceptance/import-after-local-zip64-fix.json。Standards P3：ARCHITECTURE的SH欠账已限定到旧demo DC路径。

### 03/04 双轴审计

- Standards P2和Spec P2共同发现滚轮绕过gizmo/grab归属；Standards另复现缩放后的迟到pick覆盖选择。主agent新增真实导航事件边界回归，3项先红后绿，相关12项通过。共享ownership新增hasOtherOwner，相机开始和滚轮都检查；缩放使在途选择失效。
- Spec P2：1e-50校正尺度通过有限校验但Float32变零。已反馈05当前scene.js所有者补发布前严格正值和原子保留回归，待复验。
- 六个上轴叠加世界XYZ手工角CPU对照通过；实际GPU交互仍未验。

### 05 真实 bench CPU 分辨率验证

主agent通过正式导入和prepareSceneSimulation路径，保持同一全场景参考、L=1m，测试ID1/5/8的分辨率8/16/32。三者均生成有限非空晶格与质量。质量kg依次：ID1 0.19575/0.11734/0.07472；薄ID5 0.20677/0.11033/0.06268；大ID8 907.398/398.705/189.256。ID8支持范围由未清洗Gaussian尺度决定，并非中心包围盒内的体积。结果显示近似占据质量明显依赖分辨率，不构成稳定真实质量证明，也不是GPU模拟测试。已反馈UI必须明确近似值及分辨率；证据/tmp/scene-instance-acceptance/simulation-real-bench.json。

## 主 agent 最终集成验收（2026-09-10）

### 实际浏览器与构建 Worker

- 当前右侧页面报告 Chrome/152.0.0.0，Linux x86_64，secure context=true，navigator.gpu存在；重新进行不含应用/PlayCanvas的原生请求，默认/低功耗/高性能/xrCompatible=false仍全部返回null。未获得adapter，不能记录GPU型号，也不能判定其他浏览器或硬件不支持。正式入口仍显示实际获取阶段，未成功进入渲染。
- 首次大文件选择被浏览器工具的失效节点错误打断。重新定位后，真实选择321MB PLY、NPZ及物性JSON成功。正式导入Worker取消返回ImportCancelledError；重试得到1045236行、9实例、39528未追踪、每组45SH和对应rawRows，完整指纹与前述独立结果一致。
- 正式模拟准备Worker在实际浏览器为ID1完成resolution16：657占据格、6069节点、体积0.0009554804800593487 m³、近似质量0.11734375823006825 kg；geometry/restPositions以Float32Array成功传回。这里只验证Worker和CPU准备，没有运行GPU模拟。
- Main发现生产打包错误：动态WorkerClass构造让Vite把Worker作为带相对import的data URL内联。改为生产literal Worker(new URL(...))，保留测试注入边界；构建产物回归先红后绿。生产构建现在输出独立worker和simulationWorker两份依赖完整的JS。右侧浏览器直接运行这两份构建产物，再次完成同一真实导入及ID1准备，结果一致。临时探针及其浏览器标签已清理。

### 最终 Standards

- P2：runtime保留Worker初始质量，发布前或运行中改密度后UI仍显示旧值。已增加Simulator.metricsOf稳定ID公开接口，runtime每次读取当前体积/质量/离散指标。先红后绿验证：体积0.01时密度800→900→1600，显示质量8→9→16，追加沿用当前指标。

### 最终 Spec

- P1：最终GPU等待期间修改物性仍可发布过期值；CPU公开会话复现非法density=-1仍进入running。Main已修：每次等待结束后重读并复制完整物性，变更则重新上传及验证，非法值拒绝；最后同步读取至发布之间不再异步让出。有效900及非法-1回归先红后绿。
- P1：运行/暂停时UI没有追加入口，只有准备态可加入。06已补running/paused追加入口，已参与实例禁用，UI事件边界回归通过。
- P1：source导入/配置恢复的GPU资源没有异步验证就提交，Spec reviewer已补资源创建至最终校正/着色渲染探测的validation/OOM、队列等待及失败清理。普通与配置导入共用验证事务，同设备作用域串行；销毁返回可等待且幂等的清理Promise。Main最终复验通过。
- 遗漏：05明确要求独立抓取开关。Main补Session/runtime公开操作，关闭抓取不暂停，暂停再恢复保留关闭选择；06补UI、source修复owner接应用薄方法。真实Session+runtime回归通过。

### 尚未完成的真实验收

- WebGPU设备尚未成功创建：既有demo、完整2DGS显示/拾取/着色、gizmo、两轴形变、六面与旋转接触/摩擦/抓取、实际GPU追加状态对比及返回准备显示均未验收。
- 08 agent的真实DOM测试覆盖配置文件change/submit四种情况，但准备端口明确为替身。浏览器下载事件未确认文件落盘；09完整关闭重开、真实源关联后共同模拟、清理记录再JSON恢复也未验收。
- CPU、构建和受控GPU端口测试仅证明对应边界。票的真实GPU条目保持未勾选，不能把实现提交当作全部验收完成。

### 最终检查与交付边界

- Main 最终 `npm test`：66 个文件、449 项全部通过；`npm run build` 通过；`git diff --check` 通过。构建保留PlayCanvas的node:worker_threads外部化和大bundle警告，没有把警告描述为测试失败。
- source GPU 返工补充：读取实际workbuffer访问及shader ready后才结束透明探测；核对当前引擎GPU-sort先处理普通placements的workbuffer，再做视锥筛选，离屏配置不会仅因相机位置而跳过探测。此为源码依据，真实GPU仍待验。
- 追加及抓取UI已接通：running/paused可加入合格未参与实例；running可单独关闭/开启抓取，关闭后仍运行，暂停再继续保留关闭选择。
- 临时诊断HTML、DEBUG探针和对应临时标签已移除；正式 `?app=scene` 保留在右侧。最终重载仍如实显示requestAdapter返回null。
- 实现及此记录保存到当前 `ft_upstream` 分支的本地提交；未push。九票状态为implemented-awaiting-webgpu-acceptance，尚未全部关闭。
