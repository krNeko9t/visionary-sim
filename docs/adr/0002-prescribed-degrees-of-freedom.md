# 被规定的自由度叫 prescribed，下分 static 与 kinematic

调研（[01](../../.scratch/proxy-geometry/issues/01-boundary-condition-vocabulary.md)）查实**行业
没有伞形词**：Box2D、PBD §3.6、PhysX、Vellum 全都在顶层就切成 static / kinematic 两个一等名字，
两半共用 `invMass = 0` 却没有名词同罩两者。我们仍然收了一把伞，用 FEM 工程侧的 `prescribed`
（Abaqus："degrees of freedom that are restrained/prescribed"），**理由是本仓库有一个上游没有的
需求**：`Particles` 把材料逆质量与被规定的节点合成**同一个** GPU 缓冲区，那个合成结果需要一个
名字，今天靠 `particles.js` 的一整段注释在绕过这个缺名。上游不需要伞形词，是因为它们没有做这次
合成。

如实记代价：`prescribed` 在实时图形学圈不是工作语言（高频的是 fixed / pinned / kinematic），
这是「有出处的次优」，不是共识词。次优里更硬的那个是 `constrained`（Baraff & Witkin §2.4、
DOLFINx），但它在本仓库撞车——`ARCHITECTURE.md`§三已把 constraint 定义成求解器派发的对象，而被
规定的自由度不进派发序列。

## Considered Options

- **不收伞，两个平级词条**（贴合行业）。否掉的原因见上：那个合成缓冲区会继续没有名字。
- **沿用 `anchor` 指永久固定**。否掉：01 查实 `anchor` 是一等术语且**稳定指约束的附着点**
  （Box2D joint anchor、`btSoftBody::Anchor`），读到它会期待「拴在什么东西上」，而静态规定恰恰
  没有持有者；更要命的是本仓库 `grip.js:38,54`、`simulator.js:389-411`、`drive.wgsl:22` 已经在
  这个行业语义上用掉了它。
- **`Dirichlet boundary condition`**。出处最硬（PhysDreamer 论文 §4.3 与代码 `Dirichlet_collider`
  都用它），但实时图形学一侧不是工作语言（Sifakis & Barbič 的可变形体 FEM 课程笔记全文
  `dirichlet` 出现 0 次）。留作 `CONTEXT.md` 里的一句对接，不拿它命名类型或字段。

## Consequences

- **static / kinematic 是两个词条，不是一个词条的两种生命周期，而分界轴是归属不是时长**：静态
  规定属于**物体**（随离散化确定），运动学规定属于**一次交互**（随持有者来去）。「永久 / 临时」
  是从归属推出来的后果，因此 `CONTEXT.md` 里一个字都不写——写了就会让人以为时长是原因。
- **族定义对方向性保持中立**：写成「位移由外部规定、不由求解器解出的自由度」，既不承诺也不排除
  「只在某个方向上被规定」。标量 `invMass` 今天只能表达全或无；将来换 3×3 质量矩阵
  （Baraff-Witkin §5.1）时改的是实现，不是定义。
- **采纳代价为零**：`setPrescribed` / `clearPrescribed`（`particles.js:160,166`）已在用，§三已经
  写着「被**规定**而非被**解出**」。这条 ADR 只是把已经在说的话命名成一族。
