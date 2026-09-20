# 01 · 行业里怎么称呼「被规定的自由度」

Status: claimed
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
- 结论写进本票的 `## Comments
