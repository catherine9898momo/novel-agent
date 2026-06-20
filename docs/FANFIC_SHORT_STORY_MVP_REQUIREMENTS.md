# 同人短篇 MVP 需求文档 / Fanfic Short Story MVP Requirements

> 创建时间 / Created: 2026-06-19  
> 状态 / Status: IN_PROGRESS / 进行中  
> 范围 / Scope: Novel Agent 下一阶段 MVP / Next-stage MVP for Novel Agent  
> 协作方 / Owner: Human + Codex collaboration / 用户与 Codex 协作

## 1. 目标 / Goal

构建一个人机协作的同人短篇生成工作流：用户输入一个同人创意，系统将其解析成结构化故事卡，经过人工确认后，再生成短篇计划、正文草稿、审阅结果、改写稿和最终稿。

Build a human-in-the-loop workflow for generating one short fanfiction story from a user's creative idea. The system should parse the idea into a structured story card, pause for human confirmation, then generate a one-shot plan, draft, review, rewrite, and final version.

这个 MVP 要证明 Novel Agent 能可靠地完成 schema 设计、状态流转、上下文打包、规划、起草、审阅、改写和 artifact 落盘。第一阶段的重点不是全自动，也不是立刻写出“神作”，而是让工作流稳定、可检查、可回退、可人工确认。

The MVP should prove that Novel Agent can reliably coordinate schema design, state transitions, context packing, planning, drafting, review, rewrite, and artifact persistence. The first milestone is not full automation or perfect prose, but a stable, inspectable, reversible workflow with explicit human gates.

目标流程 / Target workflow:

~~~text
User fanfic idea / 用户同人脑洞
  -> structured story card / 结构化故事卡
  -> canon/private-setting constraints / 原作设定与私设约束
  -> one-shot short story plan / 短篇计划
  -> draft / 草稿
  -> review / 审阅
  -> rewrite / 改写
  -> final / 终稿
~~~

每个关键步骤执行前和执行结果都必须经过人工确认。等工作流和质量标准稳定后，再逐步增加自动化。

Every key step must pause for human confirmation before proceeding. Automation should be added later, after the workflow and quality bar are stable.

## 2. 产品方向 / Product Direction

这个方向刻意比长篇 Novel Agent 路线更窄。同人短篇更适合作为下一阶段 MVP，因为它输入明确、约束明确、反馈周期短、人工确认点清晰，而且可以完整验证 planner、writer、reviewer、rewriter 和状态编排能力。

This direction is intentionally narrower than the long-form Novel Agent roadmap. Short fanfiction is a better MVP because it has clear input, explicit constraints, short feedback loops, obvious human confirmation points, and a realistic way to test planner, writer, reviewer, rewriter, and orchestration boundaries.

第一版只追求完成“一篇短篇闭环”，不做长篇、不做系列文、不做通用写作平台。

The first version should complete one short-story loop. It should not attempt longfic, series generation, or a general-purpose writing platform.

## 3. 范围内 / In Scope

- 静态 HTML UI 设计稿，用于验证同人创意工作台的信息架构。  
  A static HTML UI design draft for the fanfic idea workspace.
- fanfics/{story_id}/ 下的同人项目 artifact 结构。  
  A fanfic project artifact structure under fanfics/{story_id}/.
- 用于结构化创意解析的 FanficIdea schema。  
  A FanficIdea schema for structured idea parsing.
- 轻量 CanonPack schema，用于区分原作设定、私设、允许偏离和禁止偏离。  
  A lightweight CanonPack schema for canon, private settings, allowed deviations, and forbidden deviations.
- 用于短篇规划的 OneShotPlan schema。  
  A OneShotPlan schema for short-story planning.
- 带明确人工确认门的同人工作流状态机。  
  A fanfic workflow state machine with explicit human confirmation gates.
- 从确认后的 artifact 生成 Writer Context Pack。  
  Writer context pack generation from confirmed artifacts.
- 草稿、审阅、改写和终稿 artifact 落盘。  
  Draft, review, rewrite, and final artifact persistence.
- 后续实现阶段中的 CLI / workflow 命令。  
  CLI and workflow commands in later implementation phases.
- 状态流转、schema 解析、artifact 落盘测试。  
  Tests for state transitions, schema parsing, and artifact persistence.

## 4. MVP 暂不包含 / Out of Scope For MVP

- 完整长篇小说自动编排。  
  Full long-form novel orchestration.
- 自动 canon 检索、联网调研或资料抓取。  
  Automatic canon research, web retrieval, or scraping.
- 全自动审批。  
  Fully automated approvals.
- 复杂多 Agent 团队。  
  Complex multi-agent teams.
- Web 后端、登录系统、账号体系或部署。  
  Web app backend, authentication, accounts, or deployment.
- 第一阶段就把文风质量作为最高验收标准。  
  Style-perfect prose generation as the first acceptance criterion.
- 兼容所有现有长篇 novels/* artifact。  
  Compatibility with every existing long-form novels/* artifact.

## 5. 核心 Artifact / Core Artifacts

推荐目录结构 / Recommended directory structure:

~~~text
fanfics/{story_id}/
  _idea.json
  _idea.md
  _canon.json
  _preferences.json
  _plan.json
  _state.json
  _context/
    writer-context-001.json
  _drafts/
    draft-001.md
    draft-002.md
  _reviews/
    review-001.json
    review-002.json
  final.md
~~~

原则 / Principles:

- JSON 是 workflow、测试和 agent 消费的事实源。  
  JSON is the source of truth for workflow, tests, and agent consumption.
- Markdown 用于人工阅读和编辑。  
  Markdown is for human review and editing.
- LLM 不能决定文件路径或状态转移。  
  LLM output must not decide file paths or state transitions.

## 6. FanficIdea Schema / 同人创意 Schema

创意解析器需要把用户的自由输入转成结构化故事卡。

The idea parser should convert free-form user input into a structured story card.

最低字段 / Minimum fields:

~~~ts
type FanficIdea = {
  fandom: string;
  pairing?: string;
  characters: string[];
  timeline?: string;
  premise: string;
  coreTrope?: string;
  canonConstraints: string[];
  privateSettings: string[];
  mustHaveScenes: string[];
  avoid: string[];
  ratingOrSpiceLevel?: string;
  tone?: string;
  lengthTarget?: number;
  endingPreference?: "he" | "be" | "open" | "bittersweet";
  unresolvedQuestions: string[];
};
~~~

UI 必须允许用户编辑每个解析字段，然后再确认进入下一步。

The UI must let the user edit every parsed field before approving it.

## 7. CanonPack Schema / 原作与私设约束 Schema

同人质量的关键是区分“原作设定”和“本篇私设”。MVP 必须明确表达这种差异。

Fanfiction quality depends on distinguishing original canon from story-specific deviation. The MVP must make this distinction explicit.

~~~ts
type CanonPack = {
  hardCanon: string[];
  softCanon: string[];
  privateSettings: string[];
  allowedDeviations: string[];
  forbiddenDeviations: string[];
  characterVoiceNotes: string[];
  relationshipDynamics: string[];
};
~~~

第一版只需要支持人工录入和编辑。自动 canon 检索不在 MVP 范围内。

The first version only needs manual entry and editing. Automatic canon retrieval is out of scope.

## 8. OneShotPlan Schema / 短篇计划 Schema

短篇规划不应该直接复用长篇 ChapterBrief。它可以复用 required scenes、emotional beats 等底层概念，但结构必须服务于一篇完整短篇的情绪闭环。

Short-story planning should not reuse long-form ChapterBrief directly. It can share concepts like required scenes and emotional beats, but the shape must fit a complete one-shot emotional arc.

~~~ts
type OneShotPlan = {
  hook: string;
  emotionalCore: string;
  relationshipTension: string;
  sceneBeats: {
    order: number;
    purpose: string;
    summary: string;
    requiredCanonOrPrivateSetting?: string[];
  }[];
  climaxScene: string;
  endingImage: string;
  mustNot: string[];
};
~~~

长篇规划优化的是章节推进、长期记忆和未来伏笔；短篇规划优化的是梗兑现、关系张力、情绪收束和角色不 OOC。

Long-form planning optimizes for chapter progression, long-term memory, and future setup. One-shot planning optimizes for trope fulfillment, relationship tension, emotional closure, and canon-safe character behavior.

## 9. 工作流状态机 / Workflow State Machine

MVP 必须使用明确状态和合法状态转移。

The MVP must use explicit states and legal transitions.

初始状态集合 / Initial state set:

~~~ts
type FanficStatus =
  | "idea_pending_confirm"
  | "idea_confirmed"
  | "plan_pending_confirm"
  | "plan_confirmed"
  | "draft_pending_confirm"
  | "review_pending_confirm"
  | "rewrite_pending_confirm"
  | "accepted"
  | "blocked";
~~~

规则 / Rules:

- 未确认 idea，不能生成 plan。  
  No plan generation before idea approval.
- 未确认 plan，不能生成 draft。  
  No draft generation before plan approval.
- 未 review 或没有明确用户反馈，不能 rewrite。  
  No rewrite before review or explicit user feedback.
- 未人工确认，不能生成 final。  
  No final acceptance before human approval.
- 用户拒绝时，应更新 artifact 并回到上一 pending-confirm 状态，而不是静默继续。  
  Rejections should update artifacts and return to the prior pending-confirm state instead of silently continuing.

## 10. UI 设计稿要求 / UI Design Draft Requirements

第一个可视化交付物应该是静态 HTML mockup，不需要后端。它用于确认信息架构、确认门和故事卡字段是否合理。

The first visible deliverable should be a static HTML mockup with no backend. It should validate the information architecture, confirmation gates, and story-card fields.

推荐布局 / Recommended layout:

~~~text
Left:   free-form fanfic idea input / 自由同人创意输入
Center: structured story card + canon/private-setting conflict area / 故事卡 + canon/私设冲突区
Right:  workflow status, pending confirmation, next action / 工作流状态 + 待确认项 + 下一步
Bottom: tabs for OneShotPlan, Draft, Review, Rewrite notes / 短篇计划、草稿、审阅、改写标签页
~~~

必需交互 / Required UI affordances:

- 解析创意按钮。  
  Parse idea button.
- 可编辑结构化故事卡。  
  Editable structured story card.
- Canon / 私设约束编辑器。  
  Canon/private-setting constraint editor.
- 每个工作流确认门的确认、退回和修改控件。  
  Approval, revision, and rejection controls for each workflow gate.
- Plan 预览。  
  Plan preview.
- Draft 预览。  
  Draft preview.
- Review 分数面板。  
  Review score panel.
- Artifact 和状态摘要。  
  Artifact and status summary.

UI 应该像一个写作工作流控制台，而不是营销落地页。

The UI should feel like a writing workflow console, not a marketing page.

## 11. Review 维度 / Review Dimensions

同人 review 应该区别于通用文笔 review。

Fanfic review should be distinct from generic prose review.

最低维度 / Minimum dimensions:

- 角色还原 / OOC 风险。  
  Character fidelity / OOC risk.
- Canon 一致性。  
  Canon consistency.
- CP 或关系张力。  
  Pairing or relationship tension.
- 梗 / premise 兑现度。  
  Premise fulfillment.
- 必须场面兑现度。  
  Required scene fulfillment.
- 情绪余味。  
  Emotional aftertaste.
- 文风贴合度。  
  Style fit.
- 禁区踩踏。  
  Avoid-list violations.

Review artifact 应保存为 _reviews/ 下的 JSON。

Review artifacts should be saved as JSON under _reviews/.

## 12. 实现阶段 / Implementation Phases

### Phase 0 - UI 设计稿 / UI Design Draft

状态 / Status: COMPLETED / 已完成

交付静态 HTML 同人创意工作台，用它验证信息架构，再进入 workflow 代码实现。

Deliver a static HTML design draft for the fanfic idea workspace. Use it to validate the information architecture before implementing workflow code.

交互流程图 / Interaction flow: `docs/FANFIC_UI_INTERACTION_FLOW.md`

### Phase 1 - 项目初始化与状态 / Project Initialization And State

状态 / Status: COMPLETED / 已完成

新增 fanfic 项目初始化、artifact 目录、_state.json 和带测试的状态机。

Add fanfic project initialization, artifact directories, _state.json, and a state machine with tests.

实现入口 / Implementation:

- `src/fanfic-cli.ts`
- `src/fanfic/state-machine.ts`
- `src/fanfic/project.ts`
- `src/fanfic/commands.ts`
- `src/fanfic/artifacts.ts`
- `src/fanfic/types.ts`

验收方式 / Verification:

- `npx vitest run tests/fanfic-state-machine.test.ts tests/fanfic-project.test.ts`
- `npx tsc --noEmit`
- `FANFIC_ROOT=/tmp/novel-agent-fanfic-smoke npm run fanfic -- init rain-letter`
- `FANFIC_ROOT=/tmp/novel-agent-fanfic-smoke npm run fanfic -- run rain-letter parse_idea --idea "短同人创意"`
- `FANFIC_ROOT=/tmp/novel-agent-fanfic-smoke npm run fanfic -- next rain-letter`

说明 / Note:

Phase 1 CLI 暂不挂入 `src/main.ts`。它只验证 orchestrator 工程骨架：command -> state transition -> artifact write -> resumable state。

The Phase 1 CLI is intentionally standalone and not wired into `src/main.ts`. It validates the orchestrator skeleton: command -> state transition -> artifact write -> resumable state.

### Phase 2 - 创意解析与确认 / Idea Parsing And Confirmation

状态 / Status: COMPLETED / 已完成

新增 FanficIdea 解析、可编辑 JSON/Markdown 输出，以及 approve/reject/revise 动作。

Add FanficIdea parsing, editable JSON/Markdown output, and approve/reject/revise actions.

实现入口 / Implementation:

- `src/fanfic/idea-parser.ts`
- `src/fanfic/cli-input.ts`
- `src/fanfic/commands.ts`
- `src/fanfic-cli.ts`
- `src/models.ts` (`endpoints.idea`)

验收方式 / Verification:

- `npx vitest run tests/models.test.ts tests/fanfic-idea-parser.test.ts tests/fanfic-cli-input.test.ts tests/fanfic-project.test.ts`
- `npx tsc --noEmit`
- `npm test`
- `FANFIC_ROOT=/tmp/novel-agent-fanfic-phase2-smoke npm run fanfic -- init phase2-smoke`
- `FANFIC_ROOT=/tmp/novel-agent-fanfic-phase2-smoke npm run fanfic -- run phase2-smoke parse_idea --idea-file /tmp/fanfic-phase2-idea.txt`
- `FANFIC_ROOT=/tmp/novel-agent-fanfic-phase2-smoke npm run fanfic -- next phase2-smoke`

说明 / Note:

Phase 2 使用独立 `IDEA_*` 模型角色，默认可通过 `.env` 中的通用 `API_KEY`、`BASE_URL`、`MODEL` 接入 DeepSeek。CLI 同时支持 `--idea-file` 和 `--idea`，其中 `--idea-file` 面向真实长文本输入。

Phase 2 uses a dedicated `IDEA_*` model role and can default to DeepSeek through generic `.env` variables: `API_KEY`, `BASE_URL`, and `MODEL`. The CLI supports both `--idea-file` and `--idea`; `--idea-file` is preferred for real long-form input.

### Phase 3 - 短篇规划 / One-Shot Planning

状态 / Status: COMPLETED / 已完成

从已确认的 idea 和 canon artifact 生成 OneShotPlan，然后暂停等待人工确认。

Generate a OneShotPlan from confirmed idea and canon artifacts, then pause for human confirmation.

实现入口 / Implementation:

- `src/fanfic/short-planner.ts`
- `src/fanfic/commands.ts` (`generate_plan`)
- `src/models.ts` (`endpoints.fanficPlan`)

验收方式 / Verification:

- `npx vitest run tests/models.test.ts tests/fanfic-short-planner.test.ts tests/fanfic-project.test.ts`
- `npx tsc --noEmit`
- `npm test`
- `FANFIC_ROOT=/tmp/novel-agent-fanfic-phase3-smoke npm run fanfic -- init phase3-smoke`
- `FANFIC_ROOT=/tmp/novel-agent-fanfic-phase3-smoke npm run fanfic -- run phase3-smoke parse_idea --idea-file /tmp/fanfic-phase3-idea.txt`
- `FANFIC_ROOT=/tmp/novel-agent-fanfic-phase3-smoke npm run fanfic -- run phase3-smoke approve_idea`
- `FANFIC_ROOT=/tmp/novel-agent-fanfic-phase3-smoke npm run fanfic -- run phase3-smoke generate_plan`
- `FANFIC_ROOT=/tmp/novel-agent-fanfic-phase3-smoke npm run fanfic -- next phase3-smoke`

说明 / Note:

Phase 3 使用 `FANFIC_PLAN_*` 模型角色，未配置时回退到 `PLAN_*`。`_plan.json` 采用 4-5 个 scenes，每个 scene 包含 2-3 个 beats，并显式映射 required scenes 与 avoid checks。

Phase 3 uses the `FANFIC_PLAN_*` model role and falls back to `PLAN_*` when not configured. `_plan.json` uses 4-5 scenes, each with 2-3 beats, plus explicit required-scene coverage and avoid checks.

### Phase 4 - Writer Context Pack 与草稿 / Writer Context Pack And Drafting

状态 / Status: COMPLETED / 已完成

从已确认 artifact 构建 writer context pack，并生成第一版草稿到 _drafts/draft-001.md。

Build a writer context pack from confirmed artifacts and generate the first draft into _drafts/draft-001.md.

实现入口 / Implementation:

- `src/fanfic/writer-context.ts`
- `src/fanfic/drafter.ts`
- `src/fanfic/commands.ts` (`generate_draft`)
- `src/models.ts` (`endpoints.fanficWrite`)

验收方式 / Verification:

- `npx vitest run tests/models.test.ts tests/fanfic-drafter.test.ts tests/fanfic-project.test.ts`
- `npx tsc --noEmit`
- `npm test`
- `FANFIC_ROOT=/tmp/novel-agent-fanfic-phase4-smoke npm run fanfic -- init phase4-smoke`
- `FANFIC_ROOT=/tmp/novel-agent-fanfic-phase4-smoke npm run fanfic -- run phase4-smoke parse_idea --idea-file /tmp/fanfic-phase4-idea.txt`
- `FANFIC_ROOT=/tmp/novel-agent-fanfic-phase4-smoke npm run fanfic -- run phase4-smoke approve_idea`
- `FANFIC_ROOT=/tmp/novel-agent-fanfic-phase4-smoke npm run fanfic -- run phase4-smoke generate_plan`
- `FANFIC_ROOT=/tmp/novel-agent-fanfic-phase4-smoke npm run fanfic -- run phase4-smoke approve_plan`
- `FANFIC_ROOT=/tmp/novel-agent-fanfic-phase4-smoke npm run fanfic -- run phase4-smoke generate_draft`
- `FANFIC_ROOT=/tmp/novel-agent-fanfic-phase4-smoke npm run fanfic -- next phase4-smoke`

说明 / Note:

Phase 4 使用 `FANFIC_WRITE_*` 模型角色，未配置时回退到 `WRITE_*`。本阶段只做 contract validation：Markdown 非空、required scenes 覆盖、字数不少于目标 60%、明显雷点初筛；文学质量留给 Phase 5 reviewer。

Phase 4 uses the `FANFIC_WRITE_*` model role and falls back to `WRITE_*` when not configured. This phase only performs contract validation: non-empty Markdown, required-scene coverage, at least 60% of target length, and obvious avoid-list screening. Literary quality is left to the Phase 5 reviewer.

### Phase 5 - 审阅、改写与接受 / Review, Rewrite, And Accept

状态 / Status: COMPLETED / 已完成

保存 review artifact，支持多轮 rewrite，保留草稿版本，并将人工接受后的结果写入 final.md。

Save review artifacts, support rewrite attempts, preserve draft versions, and write accepted output to final.md.

Phase 5 已将 `run_review`、`generate_rewrite`、`accept_final` 从 mock artifact 替换为真实审阅、改写与终稿接受流程。状态机仍控制人工确认 gate：草稿确认后才能审阅，改写稿生成后必须重新确认草稿，终稿只能由人工接受产生。

Phase 5 replaces mock artifacts for `run_review`, `generate_rewrite`, and `accept_final` with real review, rewrite, and final-acceptance behavior. The state machine still owns the human gates: review requires a confirmed draft, rewrites must be confirmed again as drafts, and final output is only created after human acceptance.

Implementation:

- `src/fanfic/reviewer.ts`: LLM review JSON generation and validation.
- `src/fanfic/rewriter.ts`: LLM rewrite generation and contract validation.
- `src/fanfic/commands.ts`: `run_review`, `generate_rewrite`, and `accept_final` artifact orchestration.
- `src/models.ts`: `FANFIC_REVIEW_*` and `FANFIC_REWRITE_*` model roles, with fallback to `REVIEW_*` and `WRITE_*`.

Artifacts:

- `_reviews/review-001.json`: structured review score, verdict, dimension scores, issues, passed checks, and rewrite brief.
- `_drafts/draft-002.md`: rewritten draft version.
- `final.md`: accepted final story.

Verification:

- `npx vitest run tests/models.test.ts tests/fanfic-reviewer.test.ts tests/fanfic-project.test.ts`
- `npx tsc --noEmit`
- `npm test`
- Real CLI smoke path through `approve_draft -> run_review -> generate_rewrite -> approve_draft -> run_review -> accept_final`.

## 13. 验收标准 / Acceptance Criteria

MVP 成功的标准 / The MVP is successful when:

- 用户可以从一个自由同人创意开始。  
  A user can start from one free-form fanfic idea.
- 创意可以变成已确认的结构化故事卡。  
  The idea becomes a confirmed structured story card.
- Canon 和私设约束可见、可编辑。  
  Canon and private-setting constraints are visible and editable.
- 系统可以生成已确认的短篇计划。  
  The system generates a confirmed one-shot plan.
- 系统可以从明确 context pack 生成草稿。  
  The system generates a draft from an explicit context pack.
- Review 输出可追踪并落盘。  
  Review output is saved and traceable.
- Rewrite 尝试保留版本。  
  Rewrite attempts preserve versions.
- Final 只能在人工确认后生成。  
  The final story is accepted only after human confirmation.
- 测试覆盖状态转移和 artifact 落盘。  
  Tests cover state transitions and artifact persistence.

## 14. 关键风险 / Key Risks

- 在单篇短篇工作流稳定前，过早扩成平台。  
  Overbuilding a platform before the one-shot workflow is reliable.
- 让 LLM 决定状态转移或任意写路径。  
  Letting LLMs decide state transitions or write arbitrary paths.
- 把同人当成普通原创，导致 canon 和角色还原漂移。  
  Treating fanfiction as generic original fiction and losing canon fidelity.
- 只依赖 Markdown，缺少结构化 JSON artifact。  
  Relying only on Markdown instead of structured JSON artifacts.
- 在用户偏好和确认门稳定前添加自动化。  
  Adding automation before user preferences and confirmation gates are stable.

## 15. 推荐第一步 / Recommended First Action

从 Phase 0 开始：创建静态 HTML UI 设计稿。先确认工作流形态、确认门和故事卡字段，再决定代码架构。

Start with Phase 0: create the static HTML UI design draft. Validate the workflow shape, confirmation gates, and story-card fields before committing to code architecture.
