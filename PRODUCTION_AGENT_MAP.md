# Novel-Agent 生产级系统全景图

> 更新日期：2026-05-28
>
> 定位：这是 `novel-agent` 从“长篇小说工具集”升级为“生产级长篇小说 Agent”的工程地图。它用于追踪当前已有模块、缺失模块、建设优先级，以及每个模块对应的 L3 Agent 工程知识点。

## 当前一句话判断

当前 `novel-agent` 已经有单点工具、Memory/State 雏形、Reviewer/Researcher Agent、Eval 指标、Context Profiler 和 Chapter Brief 框架。

它还不是完整生产级 Orchestrator，因为现在主要靠人工触发 `metrics/context/plan/review/analyze/audit`，还没有自动根据状态推进 `planned -> drafted -> reviewed -> accepted`。

## 今日完成进度

### 1. Context Profiler

已完成：

- 新增 `src/context-profiler.ts`
- 新增 `npm run context <小说名>`
- 可统计文件字符数、估算 input tokens、任务级 context 风险
- 明确区分 `review / analyze / audit` 三类任务的上下文规模
- 将命名从 `estimateTokens` 校准为 `estimateInputTokens`

关键概念：

- Context Engineering：不同任务只拿完成任务所需的最小上下文
- Production Control：在昂贵 LLM 调用前做预算预检
- input tokens：Context Pack 作为 prompt 输入时的 token 估算，不是输出 token 预测

### 2. Chapter Brief

已完成：

- 新增 `src/chapter-brief.ts`
- 新增 `npm run plan <小说名> <章节号>`
- 生成 `_briefs/{章节号}.json`
- 第 6 章已生成 `novels/烟雨长安/_briefs/006.json`
- `_state.json` 中第 6 章状态已更新为 `planned`
- `ChapterProgress.status` 已扩展为 `pending/planned/drafted/reviewed/revised/accepted`
- 为关键函数补充 JSDoc

关键概念：

- Intermediate Artifact：Brief 是 Planner 和 Writer 之间的中间产物
- State Machine：从 `pending -> planned -> drafted`，不直接跳到全文生成
- Production Control：`validateChapterBrief()` 在进入 Writer 前校验最低信息量

### 3. 面试表达训练

今日已过的知识点：

- Context Engineering
- Chapter Brief / Intermediate Artifact
- Memory vs State
- Production Control / Validation
- Context Pack
- Orchestrator vs Writer Agent
- HITL
- Eval

## 生产级系统图谱

图例：

- `DONE`：已有且能运行
- `PARTIAL`：部分已有，但还没有完整接入生产流程
- `MISSING`：缺失
- `P0`：生产主链路必须优先补齐
- `P1`：质量闭环必须补齐
- `P2`：作品质感增强
- `P3`：规模化与体验增强

### 优先级全景图

这张图用于快速判断：哪些模块已经具备，哪些模块是 P0/P1/P2 的下一步建设重点。

```text
┌────────────────────────────────────────────────────────────────────────────┐
│                 Novel-Agent 生产级长篇小说 Agent 图谱                      │
│                  DONE 已有 | PARTIAL 部分已有 | MISSING 缺失               │
└────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────┐  ┌──────────────────────────────┐
│ 1. 创作智能层 Agents          │  │ 2. 编排控制层 Orchestrator     │
├──────────────────────────────┤  ├──────────────────────────────┤
│ DONE    Reviewer              │  │ DONE    CLI Router             │
│ DONE    Researcher            │  │ PARTIAL Workflow State     P0  │
│ DONE    Audit                 │  │ MISSING State Machine      P0  │
│ MISSING Writer            P0  │  │ MISSING continue           P0  │
│ MISSING Planner           P1  │  │ MISSING Retry/Recovery     P1  │
│ MISSING Rewriter          P1  │  │ PARTIAL Budget Control     P1  │
└──────────────────────────────┘  └──────────────────────────────┘

┌──────────────────────────────┐  ┌──────────────────────────────┐
│ 3. 上下文工程 Context         │  │ 4. 记忆与状态 Memory / State  │
├──────────────────────────────┤  ├──────────────────────────────┤
│ DONE    Context Profiler      │  │ DONE    Outline                │
│ PARTIAL Chapter Brief     P0  │  │ DONE    Characters             │
│ MISSING Writer Pack       P0  │  │ DONE    Relationships          │
│ MISSING Review Pack       P1  │  │ DONE    Story So Far           │
│ MISSING Audit Pack        P1  │  │ PARTIAL Foreshadowing      P1  │
│ MISSING Rewrite Pack      P1  │  │ PARTIAL Workflow State     P0  │
│                              │  │ MISSING Timeline/Facts DB  P2  │
│                              │  │ PARTIAL Voice Profiles     P2  │
└──────────────────────────────┘  └──────────────────────────────┘

┌──────────────────────────────┐  ┌──────────────────────────────┐
│ 5. 质量评估 Eval              │  │ 6. 人工协作 HITL              │
├──────────────────────────────┤  ├──────────────────────────────┤
│ DONE    Text Metrics          │  │ PARTIAL Manual Confirmation    │
│ DONE    LLM Review Score      │  │ PARTIAL Decision Log       P1  │
│ DONE    Coherence Audit       │  │ MISSING Brief Confirm      P1  │
│ PARTIAL Brief Validation      │  │ MISSING Accept Confirm     P1  │
│ MISSING Required Facts    P1  │  │ MISSING Low Score Pause    P1  │
│ MISSING Golden Eval       P1  │  │ MISSING Plot Change Gate   P2  │
│ MISSING A/B Comparison    P2  │  │                              │
└──────────────────────────────┘  └──────────────────────────────┘

┌──────────────────────────────┐  ┌──────────────────────────────┐
│ 7. 素材与参考 Corpus          │  │ 8. 工具与基础设施 Tools        │
├──────────────────────────────┤  ├──────────────────────────────┤
│ DONE    Style Guide           │  │ DONE    File IO                │
│ DONE    Raw References        │  │ DONE    Model Routing          │
│ MISSING Reference Retrieval P2│  │ DONE    Providers              │
│ MISSING Scene Bank        P2  │  │ PARTIAL Chapter Tools      P0  │
│ MISSING Plot Pattern Bank P2  │  │ PARTIAL State Tools        P0  │
│ MISSING Dialogue Move Bank P2 │  │ MISSING Search Tools       P2  │
│ MISSING Style Examples    P2  │  │ MISSING Review Artifacts   P1  │
└──────────────────────────────┘  └──────────────────────────────┘

P0 主链路：Writer Pack -> State Machine -> Writer Agent -> continue
P1 质量闭环：Review/Rewrite Pack -> Golden Eval -> HITL -> Recovery
P2 作品增强：Reference Retrieval -> Scene/Plot/Dialog Banks -> Timeline/Facts
```

### 当前完成热力图

```text
DONE:
  Reviewer / Researcher / Audit / CLI Router / Context Profiler
  Outline / Characters / Relationships / Story So Far
  Text Metrics / LLM Review / Coherence Audit
  Style Guide / Raw References / File IO / Model Routing / Providers

PARTIAL:
  Chapter Brief / Workflow State / Budget Control / Foreshadowing
  Brief Validation / Manual Confirmation / Decision Log
  Voice Profiles / Chapter Tools / State Tools

MISSING:
  Writer Pack / Writer Agent / State Machine / continue
  Review Pack / Audit Pack / Rewrite Pack / Rewriter Agent
  Golden Eval / Required Facts / explicit HITL gates / Review Artifacts
  Reference Retrieval / Scene Bank / Plot Bank / Dialogue Bank / Timeline
```

### 分阶段路线

```text
P0 - 让系统能自动写下一章
  1. Writer Context Pack
  2. validateWriterContextPack()
  3. Chapter State Machine 接入主流程
  4. Writer Agent
  5. npm run continue <小说名>

P1 - 让系统能审、能改、能停
  1. Review Context Pack
  2. Review Artifact 持久化
  3. Rewriter Agent
  4. Retry / Recovery
  5. Golden Eval
  6. HITL gates

P2 - 让作品更像好作品
  1. Timeline / Facts DB
  2. Reference Retrieval
  3. Scene Bank
  4. Plot Pattern Bank
  5. Dialogue Move Bank
  6. A/B Comparison
```

### 详细清单

```text
Novel-Agent 生产级长篇小说 Agent

1. 创作智能层 Agents
   DONE     Reviewer Agent        单章审阅、评分、weak spots
   DONE     Researcher Agent      全文分析、故事摘要、伏笔提取
   DONE     Audit Agent           跨章连贯性审计
   MISSING  Writer Agent      P0  基于 Writer Context Pack 写完整章节
   MISSING  Planner Agent     P1  生成更智能的 Chapter Brief
   MISSING  Rewriter Agent    P1  根据 review 反馈重写低分章节

2. 编排控制层 Orchestrator
   DONE     CLI Router            main.ts 分发 metrics/context/plan/review/analyze/audit
   PARTIAL  Workflow State    P0  novel-state.ts 有状态字段，但还没接入 continue 主流程
   MISSING  State Machine     P0  pending -> planned -> drafted -> reviewed -> revised -> accepted
   MISSING  continue          P0  自动判断下一步并调用对应模块
   MISSING  Retry/Recovery    P1  失败重试、断点恢复、错误记录
   PARTIAL  Budget Control    P1  context profiler 已有，尚未阻断超预算调用

3. 上下文工程层 Context Engineering
   DONE     Context Profiler      统计 review/analyze/audit 的 input token 规模
   PARTIAL  Chapter Brief     P0  已有规则版 brief，后续可接 Planner Agent
   MISSING  Writer Pack       P0  Writer 写作前的最小必要上下文包
   MISSING  Review Pack       P1  Reviewer 审阅前的上下文包
   MISSING  Audit Pack        P1  Audit 审计前的上下文包
   MISSING  Rewrite Pack      P1  Rewriter 重写前的上下文包

4. 记忆与状态层 Memory / State
   DONE     Outline               _outline.md
   DONE     Characters            _characters.md
   DONE     Relationships         _relationships.md
   DONE     Story So Far          _story_so_far.md
   PARTIAL  Foreshadowing     P1  _foreshadowing.json 支持，但生产更新策略未完整接入
   PARTIAL  Workflow State    P0  _state.json / STATE.md 支持，但主流程未自动消费
   MISSING  Timeline/Facts DB P2  时间线、事实库、人物状态变化表
   PARTIAL  Voice Profiles    P2  有提取函数，未形成稳定写作输入

5. 质量评估层 Eval / Quality Gate
   DONE     Text Metrics          对话占比、句长、重复短语、禁忌词密度等
   DONE     LLM Review Score      总分和维度评分
   DONE     Coherence Audit       时间线、称呼、伏笔、逻辑审计
   PARTIAL  Brief Validation      validateChapterBrief() 已有最低信息量校验
   MISSING  Required Facts    P1  检查 required_scenes / must_not / plot_hooks 覆盖情况
   MISSING  Golden Eval       P1  固定 case 回归评估
   MISSING  A/B Comparison    P2  对比不同上下文策略的质量和成本

6. 人工协作层 HITL
   PARTIAL  Manual Confirmation   目前靠人工手动看文件、跑命令
   PARTIAL  Decision Log      P1  addDecision() 已有，HITL 决策尚未接入流程
   MISSING  Brief Confirm     P1  planned -> drafted 前确认
   MISSING  Accept Confirm    P1  reviewed/revised -> accepted 前确认
   MISSING  Low Score Pause   P1  低分重写超过 N 次后暂停
   MISSING  Plot Change Gate  P2  重大剧情转向审批

7. 素材与参考层 Reference / Corpus
   DONE     Style Guide           ancient-romance.md 等风格指南
   DONE     Raw References        downloads/ 中已有参考小说原文
   MISSING  Reference Retrieval P2  按任务检索参考片段
   MISSING  Scene Bank         P2  场景素材库
   MISSING  Plot Pattern Bank  P2  情节模式库
   MISSING  Dialogue Move Bank P2  对话动作库
   MISSING  Style Examples     P2  可控引用的风格样例

8. 工具与基础设施层 Tools / Infra
   DONE     File IO               读取/写入章节、状态、brief
   DONE     Model Routing         models.ts 多角色模型路由
   DONE     Providers             Anthropic / OpenAI-compatible / DeepSeek Web
   PARTIAL  Chapter Tools     P0  隐式文件函数已有，尚未形成显式工具层
   PARTIAL  State Tools       P0  NovelState 已有，主流程未完整工具化
   MISSING  Search Tools      P2  参考作品、素材、历史事实检索
   MISSING  Review Artifacts  P1  审阅结果持久化，供 rewrite/eval 使用
```

## 当前主链路进度

目标主链路：

```text
npm run continue 烟雨长安
  -> 读取 state
  -> 判断第 6 章状态
  -> pending: 生成 Chapter Brief
  -> planned: 组装 Writer Context Pack
  -> 调用 Writer Agent 写草稿
  -> 保存章节
  -> state: drafted
  -> review
  -> rewrite / HITL / accepted
```

当前已完成到：

```text
npm run plan 烟雨长安 6
  -> 读取 _chapters.json / _story_so_far.md / 上一章摘录
  -> 生成 _briefs/006.json
  -> state: planned
```

下一步应补：

```text
P0-1 Writer Context Pack
P0-2 npm run pack 烟雨长安 6 writer
P0-3 validateWriterContextPack()
P0-4 Writer Agent
P0-5 npm run continue 烟雨长安
```

## 关键概念速记

### Context Engineering

不是把所有内容都塞给模型，而是根据任务选择最小必要上下文。

在本项目中：

- `review` 看单章、章节要求、风格指南、质量指标
- `writer` 应看 brief、故事摘要、人物关系、最近章节、相关伏笔、风格指南
- `audit` 应看摘要、伏笔、时间线、人物状态变化，而不是永远全章全文

### Context Pack

某个 Agent 执行某个任务前，由系统打包好的输入材料。

关系：

```text
Memory + State + Chapter Brief + Chapter Files + Style Guide
  -> Context Pack Builder
  -> Writer / Reviewer / Audit Agent
```

### Chapter Brief

下一章的执行规格，不是简单摘要。

包含：

- 本章目的
- 必写场景
- 情绪节拍
- 伏笔推进
- 结尾钩子
- must_not 写作边界

### Memory vs State

Memory 存长期知识和创作约束：

- 人物设定
- 人物关系
- 写作风格
- 故事摘要
- 伏笔

State 存流程进度和恢复信息：

- 当前阶段
- 当前章节
- 章节状态
- attempts
- lastError
- HITL 决策

### Orchestrator vs Writer Agent

Orchestrator 控流程：

- 什么时候 plan
- 什么时候 write
- 什么时候 review
- 什么时候 rewrite
- 什么时候 HITL
- 什么时候写回 state

Writer Agent 控表达：

- 具体场景怎么展开
- 对话怎么写
- 情绪怎么表达
- 细节如何铺陈

### Production Control

生产级 Agent 不能只相信 LLM 自觉遵守规则。代码要负责：

- runtime validation
- input token budget
- retry limit
- state transition
- failure recovery
- HITL gate

## 面试题沉淀

1. 为什么 Writer Agent 不应该直接读取所有文件？
2. Chapter Brief 为什么不是多此一举？
3. Memory 和 State 的区别是什么？
4. `validateChapterBrief()` 为什么属于 Production Control？
5. Context Pack 和 Memory/State/Brief 是什么关系？
6. Orchestrator 和 Writer Agent 的区别是什么？
7. 长篇小说 Agent 哪些节点必须 HITL？
8. 小说 Agent 的 Eval 为什么不能只看一个总分？
