# 01 · 行业里怎么称呼「被规定的自由度」

Status: resolved
Type: research

## Question

仓库现在有三样东西共用 `invMass === 0` 这一个编码，而它们不是一回事：

1. **惰性节点**——稠密点阵里周围八格都没材料的角点（`lattice.js` 的 doc comment、
   `pick.js:36`、`grip.js:108` 都靠它跳过）。
2. **被规定的节点**——`Particles.setPrescribed` / `clearPrescribed`，临时的、有持有者的，
   `KinematicDrive` 是唯一用户（`particles.js:155-156`）。
3. **锚定**（还不存在）——永久的、没有持有者的、离散化那一刻就确定。

要核实的是**外部世界怎么给这些命名**，好让仓库的词汇往共识靠而不是自创：

- **XPBD / PBD 的实现传统**：Müller 等人的原始论文与主流实现（如 Matthias Müller 的
  PBD/XPBD 参考实现、NVIDIA Flex/Warp、Blender 的 cloth/softbody）里，`w = 0` 的粒子叫什么？
  "fixed" / "pinned" / "kinematic" / "static"，哪个是主流？有没有区分「永久固定」与「本帧被
  规定」？
- **有限元 / 连续介质的文献**：位移被外部规定的自由度的标准名（我的预判是 Dirichlet boundary
  condition / essential boundary condition），以及这个词在**离散求解器实现**里实际被用到什么
  程度——是论文用语还是代码用语？
- **主流物理引擎**：Bullet、PhysX、Havok、Houdini、Blender 对「不被求解、但参与碰撞与耦合」
  的东西怎么命名（static body / kinematic body / passive collider…），以及这些词在**软体**
  语境下是否还成立。
- **`anchor` 这个词本身**：它在物理引擎里是一等术语吗？我的预判是**不是**——它更像 Blender /
  布料模拟 / 约束求解器（如 Box2D 的 joint anchor，那是"约束的附着点"，语义完全不同）那边的
  说法。如果预判成立，这张票就直接改掉 `01-anchor-mechanism.md` 的标题。
- **PhysDreamer 自身**：它的代码与论文怎么称呼那些不动的点（`clean_object_points` 之外的东西、
  官方 `demo.py` 里的相关字段）。

另外要回答一条边界问题：**「惰性节点」在外部世界有没有对应词**？我的预判是没有，因为它是稠密
网格的填充产物——换成无结构网格就不存在这种节点。如果核实下来确实没有，那它就不是这一族的第
三个成员，而是 4.2 的后果，这个结论会直接决定 `CONTEXT.md` 怎么写。

## 交付

- 每一条都要带出处（论文、仓库文件、文档页），不接受「通常认为」。
- 结论写进本票的 `## Answer`；长引文与出处清单写到
  `.scratch/proxy-geometry/research/vocabulary.md`。
- 明确回答：如果要给这一族起**一个**名字，共识词是什么；以及有没有共识词可用时的次优选择。

## Answer

详版与全部引文：[`research/vocabulary.md`](../research/vocabulary.md)。

**1. 惰性节点 → 有对应词，预判推翻。** 共识词 **inactive node**：MPM 背景网格逐步判定
active/inactive（arXiv:2605.28525 §2.1.1："The remaining nodes, outside all particle supports,
are inactive"）；静态版本在 fictitious domain FEM 里是「支撑完全在物理域外、被 eliminate 掉的
dof」（Court & Fournié, arXiv:1502.03953 §3）。**但下游判断成立且被加强**：两边都把它归为离散化
产物与要被消灭的开销，从不归进 boundary condition（稀疏 MPM 整个方向就是消灭它们）。故它**不是
本族第三个成员**，仍只进 4.2 后果表、不进 `CONTEXT.md`。建议自创的 `inert` 换成 `inactive`。

**2. 被规定的节点（临时、有持有者）→ `kinematic`。** PhysX 5.4 软体：
`PxSoftBodyFlag::ePARTIALLY_KINEMATIC` + `setKinematicTargetBufferD()`，"only expects a valid
kinematic target for ... vertices with an inverse mass of zero"；刚体侧 "Each simulation step
PhysX moves the actor to its target position, regardless of external forces"。PBD 原论文 §3.6
亦用 "kinematic object"。`KinematicDrive` 已踩在共识上，不必改。

**3. 锚定（永久、无持有者）→ `static`。** PBD §3.6 "the static target position"；Box2D
`b2_staticBody`；Vellum Pin Type = **Permanent**；Blender 源码 `CLOTH_VERT_FLAG_PINNED`。
`pinned` 亦有出处但带布料味；`static` 与 `kinematic` 成对且与 PBD 同源。

**`anchor` 裁决：预判成立，且更强。** 它**是**一等术语，但稳定指**约束的附着点**——Box2D
"Often a joint will be defined by anchor points. These are points fixed in the attached bodies."；
Bullet `btSoftBody::Anchor{ Node* m_node; btVector3 m_local; btRigidBody* m_body; }` 是软体节点↔
刚体的耦合，而固定节点另有 `setMass(node, 0.f)`。读到 `anchor` 会期待「拴在什么东西上」，而本仓库
的锚定恰恰无持有者。**更要命的是仓库内部已占用该词且用的正是行业语义**（`grip.js:38,54`、
`simulator.js:389-411`、`drive.wgsl:22`：anchor = 射线打中的那个节点）。→ `01-anchor-mechanism.md`
该改名，`08` 有了执行依据。

**Dirichlet / essential BC**：预判成立，但分两半。FEM 库里是彻底的代码用语（DOLFINx
`dirichletbc(V, value, dofs)`；Abaqus `*BOUNDARY` 的 "prescribed displacement"），PhysDreamer
亦然（论文 §4.3 "We add Dirichlet boundary conditions for stationary grid cells."，代码
`Dirichlet_collider`，使用者层 `freeze_mask`/`freeze_pts`，全程无 `anchor`）。**但实时图形学一侧
不是工作语言**：Sifakis & Barbič 可变形体 FEM 课程笔记全文 `dirichlet` 出现 **0 次**。→ 可在
`CONTEXT.md` 写一句对接，但不要拿它命名类型或字段。

**族名：没有单一共识词。** 主流在顶层就切成两半各给一等名字（Box2D `b2_staticBody`/
`b2_kinematicBody`、PBD §3.6 static/kinematic、PhysX static/kinematic actor、Vellum
Permanent/Stopped），两半共用 `invMass = 0` 却无名词同罩两者。次优：`constrained`（Baraff &
Witkin §2.4/§5.1、DOLFINx）出处最硬但**在本仓库撞车**——§三已把 constraint 定义成求解器派发的
对象，而被规定的自由度不进派发序列；`kinematic` 只覆盖一半且自带「在动」。

**→ 直接建议：族名用 `prescribed`（被规定）。** 出处是工程 FEM（Abaqus："degrees of freedom that
are restrained/prescribed"），语义正是「从外部规定而非解出」，中性于永久/临时，且与
`sim/constraints/`、`anchor`、`inactive` 都不撞。**采纳代价为零**：`setPrescribed`/
`clearPrescribed`（`particles.js:160,166`）已在用，§三「被**规定**而非被**解出**」已把族名写出来
了，只是还没被命名成类型。代价如实记：`prescribed` 在实时图形学圈不是高频词（高频的是
pinned/fixed/kinematic），它是 FEM 工程侧的词——「有出处的次优」，不是「共识词」。

```
prescribed（族名，invMass 读作 0 的原因）
├── static prescribed     ← 永久、无持有者、离散化时确定（原「锚定」）
└── kinematic prescribed  ← 临时、有持有者、每步喂目标（KinematicDrive）
inactive node             ← 族外：稠密点阵的填充产物，4.2 后果表
```

**意外收获**：Vellum 已为同一问题给过解法——Pin to Target 的 **Permanent**（`mass` 置零，不可
释放）与 **Stopped**（`stopped=1`，`mass` 保留，可释放）是两种 pin type，用「有没有保留原始
mass」编码「能不能被释放」。既证明「一个编码多种语义」是行业常态（Box2D/PhysX/B&W 佐证，本仓库
不算走歪），也证明拆开有判例，且 Permanent/Stopped 与「锚定/被规定」一一对应、同属一族。

## Comments
