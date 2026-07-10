# Novel Agent 面试案例自动沉淀设计

> 状态：Approved for planning
> 日期：2026-07-10
> 范围：commit 后提示、案例生成、去重与面试知识索引

## 1. 目标

在 Novel Agent 每次完成有意义的工程优化并产生 commit 后，系统自动发现该 commit，并询问用户是否将它沉淀为 Agent 工程师面试案例。

系统不得在未经确认时自动生成案例，也不得让 Git commit 依赖模型、网络或 Codex 是否在线。

成功标准：

- Codex 执行 commit 后，在同一任务结束前询问一次；
- 用户在外部终端执行 commit 后，下次进入 Codex 时能够发现并询问；
- 同一 commit 不重复询问；
- 用户可以选择生成、跳过、稍后处理或合并进已有案例；
- 生成内容包含真实代码、测试和设计证据，不编造指标；
- career-only commit 不递归触发新的案例询问；
- 所有沉淀统一写入 `career-prepare/novel-agent/`。

## 2. 非目标

- Git hook 不直接调用 LLM 或 Codex；
- 不在 commit 阶段阻塞、回滚或修改 commit；
- 不把每个 commit 都强制转换为面试案例；
- 不自动向外部网站、Notion 或招聘平台发布；
- 不自动提交生成的 career 文档；
- 不从代码中推断不存在的业务效果、用户数据或性能提升；
- 不在第一版实现跨仓库统一案例库。

## 3. 方案比较

### 方案 A：仅依赖 AGENTS.md 与 Skill

Codex 完成 commit 后按项目规则调用 skill。

优点：简单、交互自然。

缺点：无法发现用户在外部终端完成的 commit。

### 方案 B：Git post-commit hook 直接调用 AI

优点：任何 commit 都能立即执行。

缺点：commit 会依赖模型、网络、密钥和交互终端；失败难恢复，也可能卡住 Git。

### 方案 C：Skill + AGENTS.md + 轻量 pending hook

Codex commit 后由项目规则立即调用 skill；外部 commit 由 hook 写入 pending 标记，下次 Codex 会话处理。

优点：覆盖两类 commit，同时保持 hook 确定、快速、离线和非阻塞。

缺点：外部 commit 只能在下一次 Codex 会话询问，不是实时弹窗。

采用方案 C。

## 4. 总体架构

```text
git commit
   |
   +-- Codex 发起 ------------------------+
   |                                     |
   |                              AGENTS.md completion rule
   |                                     |
   +-- 外部终端发起 --> post-commit hook  |
                         |                |
                         v                v
                 .git/career-capture/pending/
                         |
                         v
              career-capture skill
                         |
             询问：生成 / 跳过 / 稍后 / 合并
                         |
                         v
       career-prepare/novel-agent/cases + index
```

设计分为三层：

1. Hook 只负责记录事实：“发生了一个 commit”。
2. 确定性 Career CLI 负责 pending、去重、状态和上下文采集。
3. Skill 负责与用户交互、归纳工程故事和生成面试内容。

## 5. 目录设计

```text
.agents/skills/career-capture/
  SKILL.md
  references/
    case-template.md
    interview-topic-taxonomy.md

.githooks/
  post-commit

src/career/
  types.ts
  pending-store.ts
  career-index.ts
  commit-context.ts
  eligibility.ts
  redaction.ts

src/career-cli.ts

career-prepare/
  novel-agent/
    README.md
    index.json
    cases/
      YYYY-MM-DD-<slug>.md
    topics/
      state-machine.md
      context-engineering.md
      observability.md
      evaluation.md
      human-in-the-loop.md
      reliability.md
```

Pending 状态位于 `.git/career-capture/`，不污染工作树，也不需要加入 `.gitignore`。

外部 commit 自动发现需要每个 clone 执行一次 `npm run career -- install-hook`。该命令只设置当前仓库的 `core.hooksPath=.githooks`，并由 `npm run career -- doctor` 验证。未安装 hook 时，Codex commit 的即时询问仍然有效，`rebuild-pending` 仍可补回遗漏记录，但不宣称外部 commit 已自动发现。

## 6. 触发机制

### 6.1 Codex 发起的 commit

`AGENTS.md` 增加完成规则：

1. commit 成功后读取 commit hash；
2. 调用 `career-capture` skill；
3. skill 运行 status，检查 commit 是否已经处理；
4. 若 commit eligible，则询问用户；
5. 用户没有确认前，不写 career case。

该规则只在 commit 实际成功后触发。仅 staging、生成 patch 或测试通过均不触发。

### 6.2 外部终端 commit

项目使用 tracked hook `.githooks/post-commit`。安装方式：

```text
git config core.hooksPath .githooks
```

Hook 行为：

1. 读取当前 commit hash；
2. 创建 `.git/career-capture/pending/<hash>.json`；
3. 写入 hash、branch、commit subject 和 timestamp；
4. 始终快速退出；
5. 不读取 diff、不运行测试、不调用网络和模型。

下次 Codex 开始项目工作时，`AGENTS.md` 规则要求检查 pending 状态。若存在 eligible commit，先询问是否沉淀，再继续新的实现工作。

### 6.3 防递归

满足任一条件的 commit 自动标记为 `ignored`，不询问：

- diff 只修改 `career-prepare/novel-agent/**`；
- diff 只修改 `.git` hook 安装状态；
- commit subject 以 `docs(career):` 开头；
- index 已包含该 commit hash；
- pending 状态已经是 `captured` 或 `skipped`。

## 7. 用户交互

Skill 每次只处理一个逻辑优化，默认选择最新的 eligible pending commit。

首次提示格式：

```text
检测到可沉淀的优化：
<short hash> <commit subject>

可能涉及：Orchestrator、HITL、Observability
证据：修改 8 个源码文件、5 个测试文件，相关测试通过

是否沉淀为 Agent 工程面试案例？
```

选择：

- `生成`：创建新案例；
- `跳过`：永久标记该 commit 为 skipped；
- `稍后`：保留 pending，下次再询问；
- `合并`：将该 commit 的证据加入已有案例。

选择 `合并` 后，skill 再询问目标案例。一次只问一个问题。

Skill 不把“无回复”视为生成授权。用户中断时保持 pending。

## 8. Eligible Commit 判定

Eligibility 只决定“是否值得询问”，不自动决定是否生成。

默认 eligible：

- 修改 `src/**`、`tests/**`、架构/计划文档或工作流配置；
- 引入新模块、状态、API、评估、可观测或恢复机制；
- 修复有明确根因和验证证据的问题；
- 设计文档记录了重要取舍，即使暂未修改源码。

默认 ignored：

- 只改格式、拼写或生成文件；
- 只更新 career 内容；
- merge commit 且没有独立内容；
- revert career-only commit；
- commit 已处理。

边界不确定时仍询问用户，不用模型静默决定。

## 9. 数据模型

### 9.1 Pending Record

```ts
type PendingStatus = "pending" | "deferred" | "captured" | "skipped" | "ignored";

interface PendingCommitRecord {
  commitHash: string;
  branch: string;
  subject: string;
  committedAt: string;
  detectedAt: string;
  status: PendingStatus;
  caseId?: string;
  reason?: string;
}
```

### 9.2 Career Index

```ts
interface CareerIndex {
  schemaVersion: 1;
  project: "novel-agent";
  cases: Array<{
    caseId: string;
    title: string;
    path: string;
    commitHashes: string[];
    topics: string[];
    createdAt: string;
    updatedAt: string;
    evidenceStatus: "complete" | "needs_metrics" | "needs_review";
  }>;
  decisions: Array<{
    commitHash: string;
    status: "captured" | "skipped" | "ignored";
    caseId?: string;
    decidedAt: string;
  }>;
}
```

`index.json` 是跨会话去重的项目事实源；`.git` pending store 是本地待办，可被删除和重建。

## 10. Commit Context 采集

确定性 CLI 采集：

- commit subject、body、author date；
- parent commit；
- changed files、diff stat；
- 与 commit 相关的完整 diff；
- 同次变更中新增/修改的测试；
- 关联的设计或计划文档；
- package scripts 和 CI 变化；
- 若当前任务刚完成测试，接收 skill 传入的验证结果。

不会自动采集：

- `.env`、密钥和凭据；
- downloads 中的小说原文；
- fanfic/novel 正文；
- `materials/runs/**` 中的拆解结果、evidence 和模型原始输出；
- raw model response；
- 用户未授权的外部数据。

`redaction.ts` 在 context 交给模型前过滤：

- API key/token 形态；
- 邮箱、绝对用户目录和本地秘密路径；
- 大段小说正文；
- 超出面试案例需要的原始 prompt。

## 11. 案例格式

每个 case 包含：

1. 一句话项目背景；
2. 遇到的困难；
3. 为什么这是 Agent 工程问题；
4. 约束与失败模式；
5. 考虑过的方案；
6. 最终决策及原因；
7. 关键实现；
8. 测试与验证证据；
9. 最终效果；
10. 仍存在的限制；
11. 涉及的面试知识点；
12. 面试官可能追问与回答要点；
13. 60 秒回答；
14. 3 分钟 STAR/架构回答。

若没有性能、质量或用户数据，效果部分必须写成：

- 已验证的工程结果；
- 尚未验证的业务结果；
- 下一步测量方式。

禁止把“测试通过”改写成“生产效果提升”。

## 12. Skill 行为

`career-capture` skill 的职责：

1. 调用 Career CLI 获取最新 pending 状态；
2. 读取 commit context；
3. 提取 2–5 个可能的面试主题；
4. 向用户询问是否生成；
5. 按选择创建、跳过、延期或合并；
6. 生成案例并更新 topic 索引；
7. 运行证据自检；
8. 更新 `career-prepare/novel-agent/index.json`；
9. 不自动 commit 生成结果。

Skill 必须遵循：

- 一次只询问一个 commit/优化；
- 所有事实必须能指向 commit、测试或设计文档；
- 推断必须标记为推断；
- 不确定指标标记 `needs_metrics`；
- 用户选择 skip 后不再重复询问；
- 只改 career 目录和 pending/index 状态。

## 13. CLI 合同

CLI 入口：

```text
npm run career -- status
npm run career -- context --commit <hash>
npm run career -- mark --commit <hash> --status skipped
npm run career -- capture --commit <hash> --case <caseId>
npm run career -- merge --commit <hash> --case <caseId>
npm run career -- rebuild-pending
npm run career -- install-hook
npm run career -- doctor
```

所有命令输出稳定 JSON；skill 不解析面向人的日志文本。

`rebuild-pending` 从当前分支最近 commits 与 `index.json` 的差集重建本地 pending，用于 hook 未安装或 `.git` 状态丢失的情况。

## 14. 错误与恢复

| 失败 | 行为 |
| --- | --- |
| Hook 无法写 pending | 不影响 commit，写 stderr 后退出 0 |
| Skill 启动时无 pending | 静默返回 no-op |
| Commit 已被 rebase 删除 | 标记 ignored，reason=`commit_unreachable` |
| index.json 损坏 | 停止生成，保留 pending，要求修复 |
| 案例生成中断 | 不更新 captured；下次继续询问 |
| 案例写入成功但 index 更新失败 | 通过 case frontmatter 重建 index |
| 测试证据不可得 | 标记 needs_review，不编造结果 |
| 多个 pending commits | 每次只处理一个，其余保留 |

## 15. 测试策略

### 单元测试

- eligibility 规则；
- career-only commit 防递归；
- pending 状态迁移；
- index 去重；
- redaction；
- context JSON 稳定输出；
- commit 已处理后的 no-op。

### 集成测试

- 临时 Git 仓库 commit 后生成 pending；
- hook 未安装时 `rebuild-pending` 恢复；
- skip 后不再提示；
- capture 后 commit hash 进入 case/index；
- merge 将多个 commit 绑定到一个 case；
- career-only commit 自动 ignored；
- 中断写入后能够恢复；
- hook 失败不会让 commit 失败。

### Skill 验收

- 用户确认前不创建 case；
- 生成案例中的事实均能定位到证据；
- 无指标时明确标记；
- 输出同时包含工程叙述和面试表达；
- 不读取或输出小说正文、密钥和用户隐私。

## 16. 推出顺序

1. 实现类型、pending store、index 和 eligibility；
2. 实现只记录 pending 的 hook；
3. 实现 JSON Career CLI；
4. 创建 career 目录、模板和 taxonomy；
5. 创建 `career-capture` skill；
6. 更新 `AGENTS.md` 的 post-commit 与 session-start 规则；
7. 使用已有两个 commit 做回放验收：素材流水线、Orchestrator Observability；
8. 运行 `install-hook` 配置 `core.hooksPath=.githooks`，再用 `doctor` 和一次外部 commit 验证。

## 17. 设计决策摘要

- 采用混合触发，不让 Git hook 调用 AI；
- commit 成功后才询问，不在 staging 或测试阶段询问；
- career 文档生成需要用户明确确认；
- pending 放 `.git`，正式案例放工作树；
- index 负责持久去重，pending 可以重建；
- career-only commit 自动忽略，避免递归；
- 每次处理一个 commit，允许合并到已有案例；
- Skill 负责编排和写作，CLI 负责确定性状态与证据采集；
- 第一版限定当前 Novel Agent 仓库，不做跨项目共享服务。
