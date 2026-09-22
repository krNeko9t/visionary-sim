# 02: Hat 真实资产准备、注册和交互

**What to build:** 用户准备hat资产后打开 `?scene=hat`，完整场景正确摆放，moving对应材料可抓取，固定前景及背景保持静止。

**Blocked by:** 01 — 共享 PhysDreamer 工厂，保留 alocasia 可运行。

**Status:** resolved

- [x] 使用共享工厂和小配置接入hat，无算法拷贝；给出从原始目录准备到浏览器入口的可复现命令，缺失资产时错误可定位。
- [x] 原始四输入只读；生成ignored产物，记录输入哈希、三层清洗前后数量、共同变换、源/米制包围盒。clean高度0.30m是人工声明，比例约.572579；原始高斯581454，源距离.01前景297917只是准备前核对基线。
- [x] 按01最终up判据检查真实207帧，记录原始最大38.500°及实际阈值/理由，检查局部原图与共同变换一致，不照抄alocasia55°。必要的up参数属于该场景声明。
- [x] 少量真实r候选、至少两档elementSize核对分类与材料计数，结合完整视图/局部固定与moving边界落定独立米制r。父spec原始计数仅供选候选；不自动批准.016，不以节点数健康代替语义检查，不无界穷举。
- [x] 在当前Intel UHD770真实启动 `?scene=hat`，保留完整背景、可辨认hat和代理线框；抓取moving区域并松手，有实际位移响应，固定前景/背景不动。记录设备、入口、截图或可复核证据、材料计数及简短性能结果。
- [x] 场景选择/声明和共享加载的必要回归、架构/文档护栏通过；记录已知接缝/薄结构/性能限制，性能目标未过不阻止交付。alocasia配置不改。

## 交接

详情及原始路径见父spec。不得把背景当固定材料支撑，不能为通过诊断伪造静态规定。按逐票实施→fresh code-review→root提交交付。


## Comments

### 2026-09-22 · 实施完成，awaiting independent review

基于 HEAD `1cbe63e21af2fd2be2d57f8bfdd6cc548e0a959c`。仅在共享 declarations 增加 HAT，
SCENES 用 createPhysDreamerScene(HAT) 注册；没有复制加载、分类、变换或代理算法。
alocasia 参数不变，没有改 03/04。没有新增代码目录或依赖边，因此不改架构表/依赖表。
准备、校准、运行步骤见 tools/README.md 的 Hat 段；缺失资产错误由共享加载给出场景名及 URL。
本票不自行审查或提交，Status 保持 ready-for-agent 待 fresh review。

#### 输入与共同变换

原目录 `/home/liaowanjun/Datas/physDreamer/physics_dreamer/physics_dreamer/hat` 四输入只读，
结束时重算 SHA-256 与 prepare 报告一致：

| 输入 | SHA-256 |
|---|---|
| transforms_train.json | `36978294224b2791faa9a1b1c500bf82bab95fe65d8cc21cbbcea86aec0a9959` |
| point_cloud.ply | `6e794432218926581a68d016c50407400bf71f3697fe9b0bf3b554d66f4fec12` |
| clean_object_points.ply | `dcdb0683ecac36e876443ddb3ec76491781320738848684285272d1dc0982106` |
| moving_part_points.ply | `c52f07ccc4e0820a42da27469f84abb15cee18ba878cba8ecebeb56a9dcd28ce` |

prepare 命令：

```sh
node tools/prepare-physdreamer.js --scene hat --input /home/liaowanjun/Datas/physDreamer/physics_dreamer/physics_dreamer/hat --camera-convention opengl-c2w
node tools/calibrate-physdreamer.js --scene hat --input public/splats/hat --input-kind real --r=0.003,0.006,0.009 --element-sizes=0.016,0.012 --output public/splats/hat/calibration-02
```

ignored `public/splats/hat/report.json` 最后发布，保存全部出处、输入/源与米制包围盒及207帧数据。
原始 581454 高斯、clean 295972、moving 274176；源距离 .01 切分 297917 前景、283537 背景。
三层共用清洗：完整前景清洗后253331（剔除44586）=239961动态+13370固定，
背景清洗后113120（剔除170417）。距离分类发生在清洗后，不能给两个前景子层编造独立的
清洗前计数。所有保留高斯都进入动态、固定、背景之一，背景不进入材料、抓取或接触。

共同变换仅应用一次：`0.5725790485590404*(x,z,-y)+[.2439917429819698,.14546252218557404,.04885910776152527]`。
clean 源 xyz 尺寸 [.299026728,.375950836,.523945123]；米制包围盒
min[-.085608220,0,-.107630786]、max[.085608220,.30,.107630786]，尺寸[.171216439,.30,.215261572]。
0.30 m 是人工模拟尺度，非实测。完整源场景 min[-1.897357464,-1.462371469,-1.738651276]、
max[1.464420795,2.604463339,2.150007010]；完整米制场景
min[-.842395388,-.850052771,-1.442402033]、max[1.082488409,1.376511490,.886182372]。
前景米制 y 范围[-.003446044,.305372608]来自源距离切分，未再次归一化或裁掉完整背景。

#### up 与有限候选

采用 ADR-0021 projected-world-up / 25°，全部207帧矩阵合法且投影长度>=.5，零排除。
原角最大38.500054°，检查角最大22.904085°，25°留约2.1°观察滚转余量。
目视原 images/frame_00001.png（侧前视）及最大原角 frame_00179.png（从下方仰视帽子/挂架），
挂架、门框的世界竖直与共同变换相容；并非把原角视为重力偏差，也不宣称测得重力。
没有盲抄alocasia55°。所有逐帧原角/投影角/合法性保存在report。

| r (m) | 动态/固定高斯 | h=.016 材料固定/可动 | h=.012 材料固定/可动 |
|---|---|---|---|
| .003 | 237173 / 16158 | 252 / 1392 | 429 / 2976 |
| .006 | 239961 / 13370 | 159 / 1485 | 250 / 3155 |
| .009 | 242345 / 10986 | 133 / 1511 | 208 / 3197 |

两精度材料总数1644/3405，全部候选无退化，逐点高斯分类跨精度一致；代理使用ADR-0020最近
前景标签延拓。`calibration-02/calibration.json`与每候选/精度CSV保存计数和逐点证据。
`evidence-02/regions.py`生成`regions.png`：上排全帽x/y，下排上方夹持边界z/y，红固定绿可动。
目视三候选均保留夹子/帽顶附近固定区域；.003固定带向帽体延伸更多，.009缩减固定边界更多。
选择中间值r=.006，保留上部夹持区且帽体主体可动；h=.016已可跑，.012用于交叉检查，未声称细化
必然改善针织观感。不是节点数健康即语义标定，也没有新增高度裁剪或伪造固定锚。
材料maxStretch=1.05、damping=2 /s、柔抓.003 s作为本场景初始交互声明，非针织材料实测。

#### 真实 GPU smoke 与画面

```sh
npm run dev -- --host 127.0.0.1 --port 5189
VK_DRIVER_FILES=/usr/share/vulkan/icd.d/intel_icd.json google-chrome --user-data-dir=/tmp/physdreamer02-chrome --remote-debugging-port=9353 --no-first-run --no-default-browser-check --disable-extensions --enable-unsafe-webgpu --enable-features=Vulkan --use-angle=vulkan --enable-logging=stderr about:blank
node public/splats/hat/evidence-02/smoke.mjs
node public/splats/hat/evidence-02/views.mjs
python3 public/splats/hat/evidence-02/regions.py
```

浏览器Chrome/153.0.8010.47，ANGLE Intel UHD Graphics770 ADL-S GT1，Mesa25.2.8/Vulkan；
正式 `http://127.0.0.1:5189/?scene=hat`，背景完整加载，生产模拟和渲染路径没有替换。
smoke.json记录节点1644（159静态、1485可动）、1111格、964接触节点。
从生产相机射线命中[.068042211,.176856145,.105663016]，抓11节点，无静态节点；18帧目标横移4 cm，
最大材料响应.029573250 m，固定位移0。柔抓目标与材料有距离属于声明行为。
松手后held=0；拖动后与松手30帧后所有节点位置有限。固定前景/背景最终GPU dataTransformA/B
四份SHA-256前后一致（见smoke.json），没有仅用CPU源数组代替静态检查。
松手段30帧/2.7775s=10.80108fps、丢时2.241252775s；60fps/零丢时未通过，不阻止此次可运行交付。
只有favicon.ico 404（已原样保留日志），没有页面异常或GPU错误。

目视`evidence-02/smoke.png`默认视角完整场景；`front.png`与`front-wire.png`显示帽体、上方黄色夹子、
挂架及代理。views在证据页禁用相机控制脚本，把相机移到共同变换后的真实frame1位置看向帽体，
不更改生产默认相机、不改变任何资产。首次截图仍被相机脚本覆盖，修正证据脚本后重新截取。
分类图依赖numpy/Pillow；环境无matplotlib，使用简单坐标投影，不编辑截图。

限制：默认视角偏侧，其他未覆盖扫描角度会有高斯缺口/模糊；体积代理并非针织薄壳，折边细节、
跨固定边界接缝及大幅拖动质量未充分标定，没有声称局部拖动达到理想布料观感。背景挂架无碰撞支撑。
未省略背景、未增每帧步数上限、未开展性能优化或旧08完整矩阵。

#### 验证与清理

定向 `npm test -- --run test/unit/alocasia.test.js test/unit/architecture.test.js test/unit/docs.test.js`：
3文件33项通过；新增hat注册测试走共享真实组装/代理诊断，仅替换I/O/GPU边界。
最终 `npm test`：36文件346测试通过；`npm run build`通过，保留既有worker_threads浏览器外置/
bundle大小提示。仓库无typecheck脚本。Vite与Chrome首次沙箱EPERM后按权限流程提权重跑。
所有大资产/CSV/截图/脚本仍在ignored public/splats/hat，原输入哈希重验一致。

文档更新后architecture/docs两文件14项再次通过，`git diff --check`通过。
已停止本票专用Vite5189与Chrome9353（隔离/tmp/physdreamer02-chrome），没有影响用户浏览器。

### 2026-09-22 · 独立 code-review 完成

固定基线 `1cbe63e21af2fd2be2d57f8bfdd6cc548e0a959c`，HEAD 未前进，审查该基线到工作区的
5 文件差异。独立 reviewer 按 code-review 技能另启两个 fresh gpt-6-astra / medium 子代理，
分别检查 Standards 与 Spec；两轴各 0 finding，无阻断项。

Standards：声明及注册复用共享工厂，未复制算法、增加目录或依赖；证据和运行说明位置符合
CLAUDE、issue-tracker 与 ADR-0020/0021，没有需报告的规范违反或代码异味。

Spec：独立重算四原输入 SHA-256、207 帧相机角度及校准绑定的 report/foreground/moving
哈希，均与当前产物和票据吻合。原角最大38.500054°、投影最大22.904085°，全部帧有效。
3×2 有限候选、独立 r/h、共享组装及 alocasia 配置保持符合契约。核对 smoke 脚本确实调用
生产抓取/移动/释放并读取 GPU 静态纹理；11 节点抓取、29.57 mm 响应、静止及有限性结果
与票据一致。10.80 fps 和丢时按本轮契约保留为非阻断限制。

主 reviewer 独立运行 alocasia/architecture/docs 三文件33项测试通过，`git diff --check`
通过，并确认资产/证据仍 ignored。目视原 frame_00001/frame_00179、默认 smoke、正面线框
及三 r 分类图，支持已记录的相机观察、上方固定区和薄结构/扫描缺口限制。本次独立审查未
重跑 GPU smoke，依据保存的执行脚本、结果与截图；没有重开旧08全矩阵。
仅将本票标为 resolved 并追加审查记录，未修改实现或提交；交由 root 提交。
