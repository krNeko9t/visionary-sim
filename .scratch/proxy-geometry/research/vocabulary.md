# 调研 · 「被规定的自由度」在外部世界叫什么

票：[01 · 行业里怎么称呼「被规定的自由度」](../issues/01-boundary-condition-vocabulary.md)
日期：2026-09-20

每条结论都带出处。出处只用一手材料：论文原文（含节号）、仓库源文件（含行号）、官方文档页。

---

## 0. 结论速览

| 仓库现在的叫法 | 共识词 | 出处密度 | 裁决 |
|---|---|---|---|
| 惰性节点 inert | **inactive node**（MPM）／被 eliminate 掉的 DOF（fictitious domain FEM） | 有，且是一手 | 预判**被推翻**：有对应词。但它在外面**同样不属于边界条件那一族** |
| 被规定的节点（临时、有持有者） | **kinematic**（+ kinematic target） | 很高 | 采纳；仓库的 `KinematicDrive` 已经踩在共识上 |
| 锚定（永久、无持有者） | **static**／Vellum 的 *Permanent*／Blender 的 *pinned* | 高 | 采纳 `static`；**不要**用 `anchor` |
| 整族要一个名字 | 没有单一共识词。次优且有出处：**prescribed** | 见 §6 | 采纳 `prescribed`／被规定 |

---

## 1. 编码本身：`invMass === 0` 不是本仓库的发明，也不是本仓库的过失

**一个编码承载多个语义，是这一行的常态，不是异常。** 这一条要先立住，否则后面容易把
「三样东西共用一个编码」误判成纯粹的技术债。

- Müller et al., *Position Based Dynamics*, VRIPHYS 2006，**§3.3 Constraint Projection**
  （eq. (7) 下方）：

  > "If the points have individual masses, we weight the corrections ∆pi by the inverse masses
  > wi = 1/mi . In this case a point with infinite mass, i.e. wi = 0, does not move for example
  > as expected."

- Baraff & Witkin, *Large Steps in Cloth Simulation*, SIGGRAPH 1998，**§5.1 Mass Modification**：

  > "Suppose for example that we want to keep particle i's velocity from changing. If we take
  > 1/mi to be zero, we give the particle an infinite mass, making it ignore all forces exerted
  > on it. Complete control over a particle's acceleration is thus taken care of by storing a
  > value of zero for the particle's inverse mass."

  这一节的标题本身就是这个手法的名字：**mass modification**。值得注意的是 B&W 把它推到了
  更一般的形式——他们用一个 3×3 质量矩阵表达「只在一两个方向上被规定」（§5.1 末尾，"Although
  we normally think of a particle's mass as a scalar, we need…"）。本仓库的标量 `invMass` 是
  这套东西秩为 0 的特例；「只锁住法向」这种约束在当前编码下表达不出来。

- Box2D 官方文档（Simulation → Bodies）：static body 与 kinematic body **两种不同类型共用同一个编码**：

  > static body "does not move under simulation and behaves as if it has infinite mass.
  > Internally, Box2D stores zero for the mass and the inverse mass."
  > kinematic body "behaves as if it has infinite mass, however, Box2D stores zero for the mass
  > and the inverse mass."

- PhysX 5.4 官方文档（Soft Bodies）："An inverse mass of zero means the vertex cannot be moved
  by the solver."

- NVIDIA Flex 1.1 手册（Particles）："The inverse mass is stored alongside the position, in the
  format [x, y, z, 1/m]."

**推论**：外面的人也普遍把「永久固定」和「本帧被规定」压进同一个 `invMass = 0`。区别只在于
**他们是否另外保留一个标签**来区分这两者。下一节是那个「另外保留标签」的判例。

---

## 2. 判例：Houdini Vellum 明确把「永久」和「临时」拆成两种编码

这是本票最有价值的一条外部证据——它说明仓库遇到的「一个编码三种语义」不仅是常见问题，而且
有人已经给出过解法，且解法的形状与仓库需要的完全一致。

SideFX Houdini 官方文档，**Vellum Constraints geometry node → Pin to Target → Pin Type**：

- **Permanent**：
  > "The `mass` attribute is set to zero, making the point a hard constraint. However, as no
  > original value of `mass` is stored, it isn't possible to release this constraint later."
- **Stopped**：
  > "The `stopped` attribute is set to `1` to make the point a hard constraint. `mass` is
  > unaffected so a POP operation can restore the dynamics of the point later by resetting
  > `stopped` to `0`."
- **Soft**：
  > "A zero length distance constraint is made between the point and its target location."

对应关系一目了然：

| Vellum | 本仓库 | 语义 |
|---|---|---|
| Permanent（`mass = 0`，**不可释放**） | 「锚定」（还不存在） | 永久、无持有者、离散化那一刻确定 |
| Stopped（`stopped = 1`，`mass` 保留，**可释放**） | `setPrescribed` / `clearPrescribed` | 临时、有持有者 |

Vellum 用「有没有保留原始 `mass`」来编码「能不能被释放」，与仓库用一个 `prescribed` 集合旁挂
在 `invMass` 之外是同一个思路。**Vellum 把它当两种 pin type 而不是两种东西**——即它们是同一族
的两个成员，这一点支持把 2 和 3 收进同一族。

---

## 3. 「临时被规定」的共识词：kinematic

证据密度最高的一条，且仓库已经踩对（`KinematicDrive`）。

- **PBD 原始论文，§3.6 Attachments**（一手，且正是这个语义）：

  > "With the position based approach, attaching vertices to static or kinematic objects is quite
  > simple. The position of the vertex is simply set to the static target position or updated at
  > every time step to coincide with the position of the kinematic object. To make sure other
  > constraints containing this vertex do not move it, its inverse mass wi is set to zero."

  注意这一句同时给出了**两个成员的名字**：`static target`（永久）与 `kinematic object`
  （每帧更新）。Müller 2006 就已经把这一族切成了 static / kinematic 两半。

- **PhysX 5.4 官方文档（Soft Bodies）**——软体语境，不是刚体类比：
  > "A partially kinematic softbody has kinematic targets specified for some of its vertices
  > while others can move freely (the solver will update their location to minimize the
  > softbody's internal stress)."
  > "A partially kinematic softbody only expects a valid kinematic target for simulation mesh
  > vertices with an inverse mass of zero."
  > "A fully kinematic softbody expects a kinematic target to be set for every simulation vertex"

  API：`PxSoftBodyFlag::ePARTIALLY_KINEMATIC`、`setKinematicTargetBufferD()`、
  `getSimPositionInvMassBufferD()`。

- **PhysX 5.4 官方文档（Rigid Body Dynamics）**——「谁来移动它」的定义：
  > "A kinematic actor is controlled using the `PxRigidDynamic::setKinematicTarget()` function.
  > Each simulation step PhysX moves the actor to its target position, regardless of external
  > forces, gravity, collision, etc."
  > "Thus, one must continually call setKinematicTarget(), every time step, for each kinematic
  > actor, to make them move along their desired paths."

  这正是 `KinematicDrive` 的语义：**有一个持有者，每步喂目标位置，不被求解器解出**。

**裁决**：`kinematic` 是「本帧被外部规定」的共识词，软体语境下依然成立（PhysX 的软体文档直接
用它）。仓库不必改名。

---

## 4. 「永久固定」的共识词：static / pinned，**不是** anchor

- **PBD §3.6**（上引）："the static target position"。
- **Box2D**：`b2_staticBody`，"does not move under simulation"。
- **Houdini Vellum**：Pin Type = **Permanent**（上引 §2）。
- **Blender 源码**（一手，比被 Cloudflare 挡住的手册更可靠）：
  - `source/blender/blenkernel/BKE_cloth.hh:40`：`CLOTH_VERT_FLAG_PINNED = (1 << 0),`
  - `source/blender/blenkernel/BKE_cloth.hh:97`：`float xconst[3];  /* constrained position */`
  - `source/blender/blenkernel/intern/cloth.cc:274`：`/* force any pinned verts to their constrained location. */`
  - `source/blender/blenkernel/intern/cloth.cc:655-657`：goal 权重超过 `SOFTGOALSNAP`（0.999）就
    升级成硬约束：`if (verts->goal >= SOFTGOALSNAP) { verts->flags |= CLOTH_VERT_FLAG_PINNED; }`
    ——即 Blender 有一个**软硬连续谱**（goal spring → pinned），硬端叫 `pinned`。
- **Matthias Müller 的 XPBD 参考实现**（tenMinutePhysics `14-cloth.html`，`Cloth.initPhysics`）：
  注释就一个词 `// attach`，做法是 `this.invMass[i] = 0.0;`。即参考实现层面**根本没给这个东西
  起名字**，只给动作起了名（attach）。
- **Bullet**：固定一个软体节点的办法是 `softbody->setMass(node, 0.f)`（Bullet 2.80 手册 /
  `btSoftBody.h`），**与 `Anchor` 是两套东西**——见下节。

**裁决**：永久固定这一半，`static`（跟 Box2D / PBD 论文走）与 `pinned`（跟 Blender / 布料圈走）
都有出处。`static` 更中性、与 `kinematic` 成对、且与 PBD 原论文同源；`pinned` 带布料味且暗示
「位置固定」而不涵盖「被规定成某个值」。**推荐 `static`。**

---

## 5. `anchor` 的裁决：预判成立，而且比预判更强

票里的预判是「`anchor` 不是一等术语」。实际情况要更尖锐一点：

**`anchor` 确实是一等术语，但它稳定地指另一样东西——约束的附着点（一个位置），不是一个被规定
的自由度。** 三个一手出处互相印证：

- **Box2D 官方文档（Simulation → Joints）**：
  > "Often a joint will be defined by anchor points. These are points fixed in the attached
  > bodies."
  > "Box2D requires these points to be specified in local coordinates."

  即 anchor = 某个 body 局部坐标系里的一个点，joint 挂在那里。

- **Bullet `src/BulletSoftBody/btSoftBody.h`**（一手源码）：

  ```cpp
  struct Anchor
  {
      Node* m_node;         // Node pointer
      btVector3 m_local;    // Anchor position in body space
      btRigidBody* m_body;  // Body
      btScalar m_influence;
      ...
  };
  void appendAnchor(int node, btRigidBody* body, const btVector3& localPivot,
                    bool disableCollisionBetweenLinkedBodies = false, btScalar influence = 1);
  ```

  Bullet 的 `Anchor` 是**软体节点 ↔ 刚体**的耦合，带一个 `m_local`「anchor position in body
  space」和一个 `m_influence` 权重。它是一个**两体约束**，不是「这个自由度不被求解」。Bullet
  表达后者用的是另一个 API：`setMass(node, 0.f)`。同一个库里两件事分得很干净。

- Houdini 的 SBD Constraint、Blender 的 rigid body constraint、Softimage 的 passive body 文档都
  沿用同一个语义：anchor / attachment point = 约束挂载的位置。

**两个推论：**

1. 用 `anchor` 命名「永久被规定的自由度」会与全行业的既有语义冲突——外面的人读到 `anchor`
   会期待「它被拴在**什么东西**上」，而本仓库的锚定恰恰**没有持有者**（票里自己写的：永久的、
   没有持有者的）。这是语义上的正面冲突，不是口味问题。
2. **更要命的是仓库内部已经占用了这个词**，而且占用得恰好是行业语义：
   - `src/sim/grip.js:38`：`* anchor first. nodes[0] is always the anchor node itself.`
   - `src/sim/grip.js:54`：`@param {number} anchor - Global index of the node the ray hit.`
   - `src/sim/simulator.js:389-411`：`const anchor = nearestNodeToRay(...)`
   - `src/sim/constraints/wgsl/drive.wgsl:22`：`// Offset from the handle anchor at the moment this node was taken up.`

   即本仓库的 `anchor` = **抓取的附着点**，与 Box2D/Bullet 的用法一致。再拿它去指「永久固定的
   节点」，会在同一个 `sim/` 目录下造出一词二义。

**→ 这条直接兑现了票里说的后果：`01-anchor-mechanism.md` 的标题该改，`08-reframe-anchor-ticket.md`
有了执行依据。** 建议那一族叫 static prescribed，把 `anchor` 留给 `grip.js` 现有的含义。

---

## 6. FEM / 连续介质这一侧：Dirichlet 是对的，但**不是**实时图形学的工作语言

票里的预判（标准名是 Dirichlet / essential boundary condition）成立，但「这个词在离散求解器
实现里实际被用到什么程度」这一问需要分两半回答，而两半的答案相反。

### 6.1 在 FEM 库里，它是彻头彻尾的代码用语

- **FEniCS / DOLFINx**（`dolfinx.fem`，官方 API 文档）：
  - `dirichletbc(V, value, dofs)`；类 `DirichletBC`
  - > "Create a representation of Dirichlet boundary condition which is imposed on a linear system."
  - > "dofs: Local indices of degrees of freedom in function space to which boundary condition applies."
  - > "Entries in `x` that are constrained by a Dirichlet boundary conditions are set to
    > `alpha * (x_bc - x0)`"

  注意它对这些自由度的称呼是 **"constrained"**（被约束的 dofs），而不是给它们一个名词。

- **Abaqus Analysis User's Manual，*BOUNDARY / Boundary conditions**：`prescribed` 是手册自己的
  标准动词与形容词：
  > "Prescribed displacement — In Abaqus/Standard you can prescribe jumps in displacements."
  > "degrees of freedom that are restrained/prescribed in the base state will be restrained in
  > the perturbation step"
  > 目录条目本身：'Prescribing boundary conditions as model data' / 'Fixing degrees of freedom at a point'

  这一条是 §7 推荐 `prescribed` 的出处支撑。

- **deal.II**：`VectorTools::interpolate_boundary_values` 把 Dirichlet 条件灌进 constraint
  对象；essential ≡ Dirichlet，强式施加。

### 6.2 在图形学的可变形体文献里，它几乎不出现

反证，而且是很干净的一条：**Sifakis & Barbič, *FEM Simulation of 3D Deformable Solids: A
practitioner's guide to theory, discretization and model reduction*, SIGGRAPH 2012 Course
Notes**——这是图形学可变形体 FEM 的标准入门材料。对其 PDF 全文做检索：

- `"dirichlet"` 出现次数：**0**
- `"boundary condition"` 只出现 2 次，且都是泛指，例如：
  > "…every configuration over time is the result of a rest configuration (subject to the imposed
  > kinematic constraints and boundary conditions)."

注意它把这两个词并列：**kinematic constraints and boundary conditions**。

**裁决**：Dirichlet / essential BC 是正确且精确的术语，在 FEM 库里是代码用语，甚至在 PhysDreamer
的 MPM 代码里也是（见 §7）。但在实时图形学求解器这一侧它不是工作语言。对一个 WebGPU + XPBD 的
仓库，把 `Dirichlet` 搬进变量名属于术语漂移：读者群体对不上。**可以在 `CONTEXT.md` 里写一句
「这就是 FEM 说的 Dirichlet / essential boundary condition」作为对接，但不要拿它命名类型或字段。**

---

## 7. PhysDreamer 自己怎么叫

论文与代码用两套词，都不是 `anchor`。

**论文**（arXiv:2404.13026）：

- **§4.3 Accelerating simulation with subsampling**：
  > "We add Dirichlet boundary conditions for stationary grid cells."
- **§6 Conclusion（Limitations）**：
  > "Our approach requires the user to manually specify the object to simulate and separate it
  > from the background, and establish boundary conditions for stationary parts, like the pot
  > of flowers."

**代码**（github.com/a1600012888/PhysDreamer，`main` 分支）：

- `physdreamer/warp_mpm/mpm_data_structure.py:501-503`：
  ```python
  # for various boundary conditions
  @wp.struct
  class Dirichlet_collider:
  ```
- `physdreamer/warp_mpm/mpm_solver_diff.py:173-177`（docstring）：
  > "Some boundary conditions, might not give gradient, see kernels in … `self.particle_velocity_modifiers.`
  > Mostly used to freeze points … `self.grid_postprocess,` Should apply BC here"
- `physdreamer/warp_mpm/mpm_solver_diff.py:201`：`# apply dirichlet particle v modifier`
- `projects/inference/demo.py:348-365`：面向使用者的那一层用的是 **freeze**：
  ```python
  # setup boundary condition:
  moving_pts_path = os.path.join(dataset_dir, "moving_part_points.ply")
  assert os.path.exists(moving_pts_path), \
      "We need to segment out the moving part to initialize the boundary condition"
  ...
  freeze_mask = find_far_points(sim_xyzs, moving_pts, thres=0.5 / grid_size).bool()
  freeze_pts = sim_xyzs[freeze_mask, :]
  grid_freeze_mask = apply_grid_bc_w_freeze_pts(grid_size, 1.0, freeze_pts, mpm_solver)
  ```

即：**论文层 Dirichlet BC，求解器层 `Dirichlet_collider` / `bc`，使用者层 `freeze_*`。**
`clean_object_points.ply` 与本族无关，它只是前景分割的产物（`demo.py:517, 556-561`）；真正决定
哪些点不动的是 `moving_part_points.ply` 的补集。PhysDreamer 全程**没有出现 `anchor`**。

另一条与本图 Notes 相关的观察：PhysDreamer 的固定是**按世界空间位置选出来的**
（`find_far_points(sim_xyzs, moving_pts, thres=0.5 / grid_size)`），不是离散化时确定的拓扑属性。
即它的「锚定」更接近仓库的 `grip` 那种「一团世界空间里的材料」，而不是「离散化那一刻就确定」。

---

## 8. 「惰性节点」：预判被推翻——有对应词，叫 inactive node

票的预判是「没有对应词，因为它是稠密网格的填充产物，换成无结构网格就不存在」。

**后半句（成因判断）完全正确。前半句（没有对应词）错。** 理由：稠密背景网格不是本仓库独有的，
凡是用背景网格 / 虚拟域的方法都会长出同一种节点，而且它们给它起了名字。

### 8.1 MPM：active node / inactive node

Zhao et al., *Unified sparse framework for large-scale material point method simulations*
（arXiv:2605.28525），**§2.1.1**：

> "We refer to a grid node as active at a given time step if it lies within the support of at
> least one particle."
> "The remaining nodes, outside all particle supports, are inactive and do not take part in the
> particle-grid transfers and physical update."
> "Allocating and looping over these inactive nodes leads to unnecessary memory usage and
> computational cost."

**§4.1** 给出形式定义：active-node set `𝒜 := ⋃_p 𝒮(p)`，"A grid node is said to be active if it
belongs to the support of at least one particle."

这篇论文的**存在本身**就是对成因判断的佐证：整篇文章的目的就是把这些节点从稠密网格里消掉
（§1：稠密实现里 "many grid nodes are inactive"，构成 "a major source of computational
inefficiency"）。即外部世界同样认为**这是网格的产物、是要被消掉的成本，而不是一个领域概念**。

### 8.2 Fictitious domain / finite cell FEM：直接被 eliminate 掉

Court & Fournié, *A fictitious domain finite element method for simulations of fluid-structure
interactions*（arXiv:1502.03953），**§3（离散化，Fig. 2–3 附近）**：

> "…the degrees of freedom in the solid domain S at the vertexes of the elements cut by the
> interface (the so called **virtual degrees of freedom**) do not define the field variable at
> these nodes, but they are necessary to define the fields on F and to compute the integrals
> over F. The remaining degrees of freedom, corresponding to the basis functions with support
> completely outside of the fluid, **are eliminated**."

这里有一个本仓库目前**没有**的三分法，值得记下来：

| Court & Fournié | 含义 | 本仓库 |
|---|---|---|
| 正常 dof | 支撑完全在物理域内 | 普通节点 |
| **virtual dof** | 所在单元被界面切开，本身不定义场值，但参与积分 | **没有对应物**（体素化是二值的，格子要么占要么不占） |
| 被 eliminate 的 dof | 支撑完全在物理域外 | 惰性节点 |

### 8.3 与仓库的语义差

共识词存在，但**不是 1:1**，落笔时要注意两处：

1. **时变性**。MPM 的 inactive 是**逐时间步**判定的（"at a given time step"），因为粒子在背景
   网格上流动；本仓库的惰性节点在体素化那一刻就定死，整场不变。FEM 那一侧（eliminate）才是
   静态的，与仓库一致。
2. **编码方式**。MPM 靠节点质量为零自然跳过（与仓库同构）；稀疏 MPM 干脆不分配；FEM 是把 dof
   从系统里**删掉**。三者里只有 MPM 与仓库共用 `mass = 0` 这个编码——**这正是仓库把惰性节点和
   被规定的节点混在一起的根源**：抄了 MPM 的编码，却没抄 MPM 的名字（MPM 从不把 inactive node
   叫成边界条件）。

### 8.4 对票的裁决

- 预判的**结论**（没有对应词）**推翻**：共识词是 **inactive node**（MPM），静态版本在 FEM 里是
  「被 eliminate 的 dof」。
- 预判的**下游判断**（它不是这一族的第三个成员，而是 4.2 的后果）**成立，且被外部证据加强**：
  在 MPM 与 FEM 两边，这种节点都被归为**网格 / 离散化的产物**，需要被消灭的开销，从来没有被
  归进 boundary condition。稀疏 MPM 这一整个研究方向就是消灭它们。
- **行动建议**：`inert` 是自创词，换成 `inactive` 就能白捡一个共识词，且改动只是重命名。它仍然
  只进 `ARCHITECTURE.md` 4.2 的后果表，不进 `CONTEXT.md`。

---

## 9. 整族要一个名字：没有单一共识词

先把「没有」这件事论证掉，因为它决定了要不要继续找。

**主流做法是在顶层就把这一族切成两半，各给一个一等名字**，而不是先起一个族名再分类：

| 出处 | 永久那一半 | 临时那一半 |
|---|---|---|
| Box2D（Bodies） | `b2_staticBody` | `b2_kinematicBody` |
| PBD 论文 §3.6 | "static ... objects" / "static target position" | "kinematic object" / 每帧更新 |
| PhysX | static actor | kinematic actor / `ePARTIALLY_KINEMATIC` |
| Houdini Vellum | Pin Type = Permanent | Pin Type = Stopped |
| Baraff & Witkin §2.4 | "attached to a fixed ... point in space" | "attached to a ... moving point in space"；且"the time period that a constraint is active is user-controlled" |

两半共用编码（§1），但**没有一个被广泛使用的名词同时涵盖两者**。所以「共识词」这一问的诚实答案
是：**不存在**。以下是次优选项及其代价。

### 候选 A：`constrained` —— 出处最硬，但在本仓库会撞车

- Baraff & Witkin **§2.4 Constraints**："An individual particle's position and velocity can be
  completely controlled in either one, two, or three dimensions."；**§5**："a cloth particle is
  either completely unconstrained (though subject to forces), or the particle may be constrained
  in either one, two or three dimensions."
- DOLFINx："dofs … constrained by a Dirichlet boundary condition"。

**否决理由（仓库内部）**：`ARCHITECTURE.md` §三第二条承诺把 constraint 定义成了别的东西——
`sim/constraints/` 是「自由度要服从什么」，是求解器按顺序派发的对象（而且承诺求解器**叫不出
它们的名字**）。被规定的自由度恰恰**不是**那种东西：它不进派发序列，它是 `sim/state/` 的一个
属性。拿 `constrained` 命名会让「约束」在同一个仓库里指两件事，正是本票要消除的那类歧义。

### 候选 B：`kinematic` —— 主流，但只覆盖一半

PhysX / Box2D / PBD 都用它，且软体语境成立（§3）。但 Box2D 明确把 static 排除在 kinematic 之外，
`kinematic` 自带「在动」的含义，拿来涵盖「永远不动的锚定」会别扭。

### 候选 C：`prescribed` —— **推荐**

出处：

- **Abaqus Analysis User's Manual**（§6.1 引）：`prescribed displacement`、"degrees of freedom
  that are restrained/prescribed"、"Prescribing boundary conditions as model data"。这是工程
  FEM 的标准词。
- FEM 教科书语境下 essential/Dirichlet BC 的作用就是 **prescribe** 主变量的值；`prescribed`
  是那个动作的形容词形式，语义上精确对应「位移由外部规定而不是解出」。

优点，逐条对齐本仓库的约束：

1. **语义正好是那条定义**：「displacement is prescribed from outside rather than solved for」——
   `prescribed` 就是这句话的形容词。
2. **中性于永久／临时**：它不像 `static` 暗示不动，也不像 `kinematic` 暗示在动，可以同时罩住
   两个成员。
3. **不撞车**：`sim/constraints/` 不受影响；`anchor` 留给 `grip.js`（§5）；`inert/inactive`
   留给 4.2 后果表（§8）。
4. **仓库已经在用**：`Particles.setPrescribed` / `clearPrescribed`
   （`src/sim/state/particles.js:160,166`）。采纳它的代价是**零**——不是改名，是把一个已经存在
   的词提升为族名，然后给两个成员各加一个限定词。
5. 与 `ARCHITECTURE.md` §三已有的措辞一致：「一个自由度也可以是被**规定**而非被**解出**的」。
   文档里那句话已经把族名写出来了，只是没被命名成类型。

代价（要如实记下）：`prescribed` 在**实时图形学**圈子里不是高频词——高频词是 `pinned` /
`fixed` / `kinematic`。它是 FEM 工程侧的词。所以它算「有出处的次优」，不算「共识词」。

### 推荐落法

```
prescribed（被规定的自由度）        ← 族名，invMass 读作 0 的原因
├── static prescribed（静态规定）    ← 永久、无持有者、离散化时确定。原「锚定」
└── kinematic prescribed（运动学规定）← 临时、有持有者、每步喂目标。KinematicDrive
```

族外，不是成员：

```
inactive node（惰性/非活跃节点）     ← 稠密点阵的填充产物。ARCHITECTURE.md 4.2 后果表
```

---

## 10. 出处清单

**论文**

- M. Müller, B. Heidelberger, M. Hennix, J. Ratcliff. *Position Based Dynamics*. VRIPHYS 2006.
  §3.3 Constraint Projection；§3.6 Attachments.
  <https://matthias-research.github.io/pages/publications/posBasedDyn.pdf>
- D. Baraff, A. Witkin. *Large Steps in Cloth Simulation*. SIGGRAPH 1998. §2.4 Constraints；
  §5 Constraints；§5.1 Mass Modification.
  <https://courses.cms.caltech.edu/cs176/projects/project6/p43-baraff.pdf>
- E. Sifakis, J. Barbič. *FEM Simulation of 3D Deformable Solids*. SIGGRAPH 2012 Course Notes.
  （全文 `dirichlet` 出现 0 次；"kinematic constraints and boundary conditions"）
  <https://viterbi-web.usc.edu/~jbarbic/femdefo/>
- T. Zhang et al. *PhysDreamer: Physics-Based Interaction with 3D Objects via Video Generation*.
  ECCV 2024. §4.3；§6 Limitations. <https://arxiv.org/html/2404.13026v1>
- Zhao et al. *Unified sparse framework for large-scale material point method simulations*.
  §1；§2.1.1；§4.1. <https://arxiv.org/html/2605.28525v2>
- S. Court, M. Fournié. *A fictitious domain finite element method for simulations of
  fluid-structure interactions*. arXiv:1502.03953. §3. <https://arxiv.org/pdf/1502.03953>

**源码**

- `bulletphysics/bullet3` — `src/BulletSoftBody/btSoftBody.h`（`struct Anchor`、`appendAnchor`）
  <https://github.com/bulletphysics/bullet3/blob/master/src/BulletSoftBody/btSoftBody.h>
- `blender/blender` — `source/blender/blenkernel/BKE_cloth.hh:40,97`；
  `source/blender/blenkernel/intern/cloth.cc:274,655-657`
- `a1600012888/PhysDreamer` — `physdreamer/warp_mpm/mpm_data_structure.py:501-503`；
  `physdreamer/warp_mpm/mpm_solver_diff.py:173-177,201`；`projects/inference/demo.py:348-365`
- Matthias Müller, tenMinutePhysics `14-cloth.html`（`// attach` + `invMass[i] = 0.0`）
  <https://matthias-research.github.io/pages/tenMinutePhysics/>

**官方文档**

- Box2D — Simulation（Bodies / Joints）：<https://box2d.org/documentation/md_simulation.html>
- NVIDIA PhysX 5.4 — Soft Bodies：
  <https://nvidia-omniverse.github.io/PhysX/physx/5.4.1/docs/SoftBodies.html>
- NVIDIA PhysX 5.4 — Rigid Body Dynamics：
  <https://nvidia-omniverse.github.io/PhysX/physx/5.4.1/docs/RigidBodyDynamics.html>
- NVIDIA Flex 1.1 — Manual（Particles）：
  <https://archive.docs.nvidia.com/gameworks/content/gameworkslibrary/physx/flex/manual.html>
- SideFX Houdini — Vellum Constraints geometry node（Pin to Target / Pin Type）：
  <https://www.sidefx.com/docs/houdini/nodes/sop/vellumconstraints.html>
- FEniCS DOLFINx 0.9 — `dolfinx.fem`（`dirichletbc`、`DirichletBC`）：
  <https://docs.fenicsproject.org/dolfinx/v0.9.0/python/generated/dolfinx.fem.html>
- Abaqus Analysis User's Manual — Boundary conditions / `*BOUNDARY`：
  <https://abaqus-docs.mit.edu/2017/English/SIMACAEPRCRefMap/simaprc-c-boundary.htm>

**未能取证**

- Blender 官方手册页（Cloth → Shape → Pinning，Soft Body → Goal）被 Cloudflare 人机校验挡住，
  未绕过。§4 改用 Blender 源码取证，结论不受影响。
- Havok 文档需登录，未取证。
