---
caseId: 2026-07-11-career-capture-reliability
title: 将提交后的面试沉淀做成非阻塞、可恢复的 Agent 旁路
commitHashes: ["1f2af16bfbbff6360e9b84a1a3998a5ddf862ec2"]
topics: ["reliability", "human-in-the-loop", "testing", "state-machine"]
evidenceStatus: needs_metrics
createdAt: 2026-07-11T00:00:00Z
updatedAt: 2026-07-11T00:00:00Z
---

# 将提交后的面试沉淀做成非阻塞、可恢复的 Agent 旁路

## 一句话背景

Novel Agent 的每次工程优化都可能成为面试案例，但直接依赖人工复盘容易遗漏，因此需要在 commit 后自动发现候选工作，同时确保未经用户确认绝不生成案例。

## 遇到的困难

这个需求看起来像“提交后弹一个问题”，实际跨越了 Git Hook、持久化状态、Codex 会话、证据提取和人工确认五个边界。Git Hook 不能可靠地启动实时 AI 对话，也不能因为沉淀流程失败而阻塞正常提交；同一提交还可能被 Hook 和后续扫描重复发现。案例生成需要读取代码证据，但不能把小说正文、素材、环境变量或凭据带入上下文。

## 为什么这是 Agent 工程问题

它不是单纯的 Git 自动化，而是一个带人工控制点的异步 Agent 工作流：外部事件先产生 durable pending state，下一次 Agent 会话恢复任务，工具提取受限证据，Skill 请求用户做出明确决策，最后再更新状态。这里同时涉及 orchestration、tool contract、state machine、human-in-the-loop 和失败恢复。

## 约束与失败模式

- Hook 必须快速返回，内部脚本退出 1 也不能让 `git commit` 失败。
- 删除 pending 记录后，已 captured 的提交不能被重新创建。
- `docs(career):` 和只修改案例库的提交必须忽略，否则会递归触发。
- 索引损坏时，`status` 必须失败且不能顺带修改 pending 状态。
- 根提交没有父提交，普通 `git diff-tree` 调用可能返回空文件列表，导致首个工程提交被误判为 trivial。
- 未经用户确认不能创建案例；案例生成后也不能自动 commit。

## 方案比较

1. 在 post-commit Hook 中直接调用 AI：交互时机及时，但会把网络、模型和用户交互耦合进 Git 关键路径，可靠性和可控性都较差。
2. 每次会话只扫描 Git 历史：实现简单，但缺少即时记录，且需要持续处理去重和扫描范围问题。
3. Hook 记录 pending，加 `rebuild-pending` 恢复，再由 Skill 询问用户：多一个状态层，但能把 Git 的可靠性边界与 AI 的交互边界分开。

## 最终决策

采用第三种混合方案。Hook 只原子发布最小 pending 记录并始终非阻塞退出；Career CLI 负责恢复、分类、证据提取和状态迁移；项目 Skill 只处理最新 eligible 提交，并向用户提供“生成 / 跳过 / 稍后 / 合并”四个明确选择。

## 关键实现

- `.githooks/post-commit` 调用本地 helper，但用非阻塞语义隔离失败。
- pending 文件保存提交哈希、分支、主题、时间和状态，index 保存 captured/skipped/ignored 的持久决策。
- `rebuild-pending` 从最近提交恢复漏记记录，并依据 index 去重。
- `status` 先加载有效索引，再分类 pending；索引无效时不会产生部分状态更新。
- 提交上下文只为安全路径读取 diff，并通过 `git diff-tree --root` 正确处理根提交。
- `career-capture` Skill 把用户确认作为生成案例的硬门槛。

## 测试与证据

提交 `1f2af16bfbbff6360e9b84a1a3998a5ddf862ec2` 修改 1 个源码文件、3 个测试文件和 1 个说明文件，共 185 行新增、3 行删除。端到端测试使用真实临时 Git 仓库覆盖：rebuild 发现、capture 登记、删除 pending 后不复活、career-only 忽略、Hook helper 失败不阻塞 commit、损坏 index 时 pending 不变。另有独立回归测试验证根提交必须携带 `--root`。

实施会话中的验证结果：focused suite 为 3 个文件、7 项测试通过；完整 `npm run check` 为 46 个测试文件、184 项测试通过；真实 `doctor` 返回 `configured: true`、`hookExists: true`。

## 最终效果

### 已验证

- 正常工程提交能够通过 Hook 或 `rebuild-pending` 进入待确认队列。
- 已处理提交不会因 pending 丢失而重复出现。
- career-only 提交不会递归触发沉淀。
- Hook helper 失败不影响 Git commit 成功。
- 损坏索引不会造成 pending 的部分写入。
- 根提交能够被识别为工程变更。
- 用户已经通过真实 Skill 流程明确选择“生成”，证明确认门可被实际执行。

### 尚未验证

- 尚无长期生产数据证明它能减少多少面试复盘时间。
- 尚未测量候选提交的误报率、漏报率和用户选择分布。
- 尚未验证大型仓库与高频提交场景下的扫描延迟。
- 尚未验证生成案例在真实面试中的复用率和回答质量提升。

### 下一步测量

- 记录 eligible 候选数、生成/跳过/稍后/合并比例和 deferred 停留时间。
- 测量 Hook 执行 p95、`status` 与 `rebuild-pending` 延迟。
- 人工抽样评估候选提交的误报率和敏感信息过滤召回率。
- 记录案例被复习、被合并和用于面试回答的次数。

## 设计取舍与遗留问题

系统接受“外部 commit 只能在下一次 Codex 会话被询问”的非实时体验，以换取 Git 提交路径不依赖模型或网络。当前恢复窗口只扫描有限数量的最近提交，极端长期离线后可能需要扩大范围。状态以本地文件保存，适合个人项目，但多人协作时还需要明确索引合并和所有权策略。

## 面试知识点

- 如何把 Agent 从同步回调改造成可恢复的异步工作流。
- 如何设计 pending、deferred、captured、skipped、ignored 状态及幂等迁移。
- 如何用 human-in-the-loop 防止系统把一次修改误学成永久偏好或永久知识。
- 如何设计非阻塞 Hook、原子发布、故障注入和真实 Git E2E。
- 如何区分测试已验证效果与需要生产指标支持的效果。

## 追问与回答要点

**为什么不在 Hook 中直接调用 Agent？** Git Hook 位于开发者关键路径，网络或模型失败会拖慢甚至破坏 commit；记录事件和发起交互应该解耦。

**如何避免重复询问？** pending 负责待处理状态，index 负责持久决策；重建时同时检查两者，capture/skip 后同一哈希不会再次进入 eligible 列表。

**索引和 pending 写到一半怎么办？** 命令先验证 pending 和案例元数据，再更新 index；读取到损坏 index 时立即失败。Hook 采用不可覆盖的原子发布，避免并发覆盖已处理记录。

**怎么证明不是只测 mock？** 核心 E2E 在临时目录初始化真实 Git 仓库，实际执行 init、add、commit、config 和 rev-parse，并调用生产 CLI。

## 60 秒回答

我把“commit 后自动沉淀面试案例”拆成了一个异步、可恢复的 Agent 工作流。Git Hook 不调用模型，只原子记录 pending，而且 helper 失败也不阻塞 commit。下一次 Codex 会话由 Career CLI 恢复和分类提交，安全提取 diff，再由 Skill 让用户选择生成、跳过、稍后或合并。index 保存永久决策，解决重复发现；career-only 提交会被忽略，避免递归。最后我用真实临时 Git 仓库覆盖恢复、去重、Hook 故障和索引损坏，并修复了根提交因缺少 `--root` 被误判的问题。完整回归是 46 个测试文件、184 项测试通过，但生产节省时间等效果仍标记为待测量。

## 3 分钟回答

这个需求最初只是希望每次项目优化后自动问一句要不要沉淀面试案例，但真正的难点在于 Git 事件和 AI 对话不在同一个可靠性边界。直接从 post-commit Hook 调模型，会把网络延迟、模型失败和交互等待放进 Git 关键路径，所以我先把系统拆成事件记录、状态恢复、证据提取、人工决策、案例登记五步。

Hook 只写一个最小 pending 记录，并保证内部 helper 失败时 commit 仍成功。CLI 维护 pending 和 index：pending 表示尚未完成的工作，index 表示 captured、skipped 或 ignored 的永久决策。下一次会话可以运行 `rebuild-pending` 扫描最近历史，补回没有经过 Hook 的外部提交；因为它会检查 index，已经处理过的哈希不会复活。

然后我把安全和人工确认做成硬约束。提交上下文只读取允许的源码、测试和设计文档，小说、素材、环境变量和凭据不会进入 safe diff。项目 Skill 每次只处理最新 eligible 提交，必须让用户选择生成、跳过、稍后或合并，未经确认不得创建案例，也不能自动 commit。

可靠性测试没有只停留在 mock。我在临时目录初始化真实 Git 仓库，实际创建提交并验证 rebuild、capture、去重、career-only 忽略、Hook helper 退出 1 不影响 commit，以及损坏 index 时 pending 保持不变。这个 E2E 还发现根提交没有父提交时 `diff-tree` 默认不列文件，首个工程提交会被误判；最终通过 `--root` 修复并加了独立回归测试。当前完整测试为 46 个文件、184 项通过。对于“节省了多少复盘时间”之类结果，我没有编造数字，而是把它留在 needs_metrics，并给出后续采集指标。
