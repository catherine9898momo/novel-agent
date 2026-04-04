# Novel Agent — 功能与架构文档（GSD 重构版）

> 本项目借鉴 [GSD (Get Shit Done)](https://github.com/gsd-build/get-shit-done) 的核心理念：
> **Context Engineering + Thin Orchestrator + Specialized Agents + Verify as First-Class Citizen**

## 功能概览

| 功能 | 说明 |
|------|------|
| 多部小说管理 | CLI 参数直接指定，或交互菜单列出 `novels/` 下所有目录 |
| **STATE.md 会话状态** | 跨会话持久化：当前阶段、用户决策、写作统计、会话交接记录 |
| **薄编排器** | Orchestrator 只做 spawn → wait → integrate → route，不执行业务逻辑 |
| **专用 Agent 分离** | Planner / Writer / Reviewer / Researcher 各司其职，每个 Agent 拿到全新 200k 上下文 |
| **XML 结构化章节计划** | 精确场景、伏笔、情绪弧线、验证清单，取代自由文本计划 |
| **验证流水线** | XML Plan 验证 → 章节自评 → 连贯性审计，验证是一等公民 |
| 状态自动检测 | 启动时扫描小说目录，判断缺少哪些规划文件和章节 |
| 逆向提取规划 | 已有章节但无规划时，基于已有章节内容推断大纲/人物/关系 |
| HITL 确认 | 每个规划产物生成后暂停，用户可输入 `y` 确认或输入反馈重新生成 |
| 精准上下文注入 | 每章写作注入：风格 + 大纲 + 人物 + XML计划 + 摘要 + 上章结尾2000字 + 交接备忘 + 伏笔状态 + 声音档案 + 情绪曲线 + 知识库 + 用户偏好 |
| 任务持久化 | `_todo.json` 记录每章状态，重启后自动续写未完成章节 |
| **Session pause/resume** | STATE.md 记录会话交接信息，支持跨会话恢复 |
| 上下文压缩 | 三层策略防止 token 超限（微压缩 / 自动摘要 / LLM 主动压缩） |

---

## 整体架构

```
novel-agent/
├── src/
│   ├── novel-agent.ts      # CLI 入口 + 共享类型导出（108行）
│   ├── orchestrator.ts     # 薄编排层：阶段路由 + HITL 确认
│   ├── novel-state.ts      # STATE.md 会话状态管理
│   ├── xml-plan.ts         # XML 结构化章节计划
│   ├── agents/
│   │   ├── planner.ts      # 规划 Agent（大纲/人物/关系/章节列表）
│   │   ├── writer.ts       # 写作 Agent（精准上下文注入）
│   │   ├── reviewer.ts     # 审阅 Agent（自评/验证/连贯性审计）
│   │   └── researcher.ts   # 分析 Agent（全文分析/声音提取）
│   ├── agent-loop.ts       # 核心 Agent 循环（工具调用驱动）
│   ├── tools.ts            # 工具定义 + 实现
│   ├── todo.ts             # 任务列表持久化
│   ├── context-compact.ts  # 上下文压缩三层策略
│   ├── knowledge-base.ts   # 知识库（素材/偏好）
│   └── models.ts           # 多模型路由配置
├── novels/
│   └── {小说标题}/
│       ├── _state.json         # 会话状态（程序读取）
│       ├── STATE.md            # 会话状态（人类可读 + LLM注入）
│       ├── _outline.md         # 故事大纲
│       ├── _characters.md      # 人物设定
│       ├── _relationships.md   # 人物关系
│       ├── _chapters.json      # 章节列表（含元数据）
│       ├── _todo.json          # 任务状态
│       ├── _story_so_far.md    # 累积故事摘要
│       ├── _foreshadowing.json # 伏笔追踪
│       ├── _voice_profiles.md  # 角色声音档案（缓存）
│       ├── _handoff_NNN.md     # 章节交接备忘
│       ├── _skip_chapters.json # 跳过的章节
│       ├── _premise.md         # 用户故事前提（可选）
│       └── 001-章节标题.md     # 章节正文
└── skills/styles/
    └── ancient-romance.md      # 写作风格指南
```

### 模块职责（GSD 分层）

```
novel-agent.ts          ← CLI 入口（108 行）
    │
    └── Orchestrator     ← orchestrator.ts（薄编排层）
            │
            ├── NovelState          ← novel-state.ts（STATE.md 管理）
            │
            ├── Phase: Planning
            │   └── PlannerAgent    ← agents/planner.ts
            │       ├── runPlanAgent()              大纲/人物/关系
            │       └── runChapterProposalAgent()    章节列表
            │
            ├── Phase: Analysis
            │   └── ResearcherAgent ← agents/researcher.ts
            │       ├── runAnalysisAgent()           全文分析
            │       ├── extractVoiceProfiles()       声音档案
            │       └── loadExistingChaptersText()   已有章节加载
            │
            ├── Phase: Writing（每章循环）
            │   ├── XmlPlan         ← xml-plan.ts
            │   │   └── generateXmlChapterPlan()     XML 结构化计划
            │   │
            │   └── WriterAgent     ← agents/writer.ts
            │       ├── runWriterAgent()             写作执行
            │       └── cleanupForRewrite()          重写清理
            │
            └── Phase: Verify（每章后）
                └── ReviewerAgent   ← agents/reviewer.ts
                    ├── reviewChapter()              章节自评
                    ├── verifyAgainstPlan()           XML Plan 验证
                    └── runCoherenceAudit()           连贯性审计

所有 Agent 共享：
    agentLoop()         ← agent-loop.ts（核心循环）
    ToolHandlers        ← tools.ts（工具定义）
    CompactOptions      ← context-compact.ts（压缩策略）
    endpoints           ← models.ts（多模型路由）
```

---

## GSD 核心模式

### 1. Context Engineering（上下文工程）

每个 Agent 拿到全新的 200k 上下文窗口，只注入该任务所需的最小信息集：

| Agent | 注入的上下文 |
|-------|-------------|
| Planner | 风格指南 + 前序规划 + 已有章节（逆向） + 前提 + 用户偏好 + HITL反馈 |
| Writer | 风格 + 大纲 + 人物 + 关系 + XML计划 + 摘要 + 上章2000字 + 交接备忘 + 伏笔 + 声音档案 + 情绪曲线 + 知识库 + 用户偏好 |
| Reviewer | 风格指南 + 本章内容 + 本章要求 |
| Researcher | 风格指南 + 全文 + 大纲 + 人物 + 关系 + 章节列表 |

### 2. STATE.md（会话状态持久化）

```
STATE — 《沈清辞-萧衍》

> 当前阶段: **writing** | 当前章节: **第5章**

## 规划进度
  - ✅ outline
  - ✅ characters
  - ✅ relationships
  - ✅ chapters

## 写作统计
  - 进度: 4/10 章
  - 总字数: 8500
  - 平均评分: 4.2/5
  - 重写次数: 1

## 用户决策
  - **outline**: 需要更多宫廷政治线索
  - **第3章 计划**: 加入月下对话场景
```

### 3. XML 结构化章节计划

```xml
<chapter_plan num="5" title="困局">
  <pov>沈清辞</pov>
  <setting>太子府书房 → 御花园</setting>
  <emotional_arc from="压抑" to="爆发" />
  <target_words>2000</target_words>

  <scenes>
    <scene order="1">
      <description>太子召见，暗示知晓密信</description>
      <emotion>紧张、不安</emotion>
      <transition>书房烛光渐暗，引出御花园夜行</transition>
    </scene>
    <scene order="2">
      <description>御花园偶遇萧衍</description>
      <emotion>从戒备到心软</emotion>
    </scene>
  </scenes>

  <foreshadowing>
    <plant desc="玉簪的来历" detail="预期第8章回收" />
    <advance desc="第3章的密信" detail="从埋下推进到推进中" />
  </foreshadowing>

  <hooks>
    <opening>以太子的一句话开篇，暗含威胁</opening>
    <closing>萧衍留下的一句话，意味深长</closing>
  </hooks>

  <verify>
    <check>角色称谓一致</check>
    <check>时间线不矛盾</check>
    <check>字数不少于2000</check>
  </verify>
</chapter_plan>
```

### 4. 验证流水线（Verify as First-Class Citizen）

```
写作完成
  │
  ▼
HITL 用户审阅 ──s→ 直接通过
  │y
  ▼
verifyAgainstPlan()     ← XML Plan 验证
  ├── 字数检查（本地）
  ├── 场景覆盖检查（LLM）
  └── 伏笔操作检查
  │
  ▼
reviewChapter()         ← 章节自评（1-5分，4分及格）
  │
  ├── ≥ 4分 → 通过，5分提取佳段入知识库
  └── < 4分 → 注入反馈重写（最多3次）
  │
  ▼
每 5 章 → runCoherenceAudit()  ← 连贯性审计
  ├── 时间线矛盾
  ├── 人物行为不一致
  ├── 遗忘的伏笔
  ├── 场景逻辑漏洞
  └── 语气/称呼变化
```

---

## 功能流程图

### 主流程（Orchestrator 编排）

```
启动
  │
  ▼
novel-agent.ts: selectNovel()
  │
  ▼
Orchestrator.run()
  │
  ├── NovelState.load()         加载/创建 STATE
  ├── startSession()            记录会话开始
  │
  ▼
┌─────────────────────────────────────────┐
│   Phase 1: Planning（规划）              │
│   Orchestrator → PlannerAgent            │
└─────────────────────────────────────────┘
  │
  ├── for each missing [outline, characters, relationships]
  │   ├── runPlanAgent(type)    ← 全新上下文
  │   ├── hitlGate(type)        ← HITL 确认
  │   └── state.markPlanningDone(type)
  │
  └── if !hasChapters
      ├── runChapterProposalAgent()
      └── hitlGate("章节列表")
  │
  ▼
┌─────────────────────────────────────────┐
│   Phase 1.5: Analysis（按需）            │
│   Orchestrator → ResearcherAgent         │
└─────────────────────────────────────────┘
  │
  ├── runAnalysisAgent()        重建故事状态
  ├── HITL 确认分析结果
  └── handleMissingChapters()   缺失章节处理
  │
  ▼
┌─────────────────────────────────────────┐
│   Phase 2: Writing（写作）               │
│   每章: Plan → Write → Verify            │
└─────────────────────────────────────────┘
  │
  ▼
for each pending chapter
  │
  ├── buildWriteContext()       精准上下文组装
  │
  ├── planChapter()             ← XML 章节计划 + HITL
  │   └── generateXmlChapterPlan()
  │
  ├── writeAndVerifyChapter()   ← 写作 + 验证循环
  │   ├── runWriterAgent()      全新上下文写作
  │   ├── HITL 用户审阅
  │   ├── verifyAgainstPlan()   XML 验证
  │   ├── reviewChapter()       自评评分
  │   └── 不及格? → cleanupForRewrite() → 重试
  │
  └── 每 5 章 → runCoherenceAudit()
  │
  ▼
state.pauseSession()            保存会话交接
```

---

### Agent Loop（核心循环，不变）

```
agentLoop(system, messages, tools, handlers)
  │
  ▼
┌──────────────────────────────────────┐
│  client.messages.create(messages)    │
└──────────────────────────────────────┘
  │
  ▼
stop_reason == "tool_use"?
  │否 ──▶ return（任务完成）
  │是
  ▼
for each tool_use block
  ├── handlers[tool.name](tool.input)
  └── 收集 tool_result
  │
  ▼
messages.push(tool_results)
  │
  ▼
压缩检查
  ├── microCompress：截断旧 tool_result（保留最近 3 条）
  └── autoCompress：超过 80k token 时 LLM 摘要替换历史
  │
  ▼
回到顶部继续循环
```

---

### 工具清单

| 工具 | 用途 | 调用方 |
|------|------|--------|
| `write_plan` | 保存 outline/characters/relationships | Planner |
| `read_plan` | 读取规划文件 | Writer |
| `propose_chapters` | 提交章节列表 | Planner |
| `write_chapter` | 保存章节正文（幂等） | Writer |
| `read_chapter` | 读取已有章节 | Writer |
| `list_chapters` | 列出已完成章节 | Writer |
| `write_story_so_far` | 更新累积故事摘要 | Writer |
| `read_story_so_far` | 读取故事摘要 | Writer |
| `write_handoff` | 写章节交接备忘 | Writer |
| `update_foreshadowing` | 更新伏笔状态 | Writer |
| `update_todo` | 更新任务状态 | Writer |
| `compact` | 主动触发上下文压缩 | 任意 Agent |

---

## 重构前后对比

| 维度 | 重构前 | 重构后（GSD 模式） |
|------|--------|-------------------|
| 入口文件 | `novel-agent.ts` 1183 行 | `novel-agent.ts` 108 行 |
| 编排 | main() 函数包含全部逻辑 | `orchestrator.ts` 薄编排 |
| Agent | 内联函数，共享上下文 | 独立模块，全新上下文 |
| 章节计划 | 自由文本 | XML 结构化（场景/伏笔/验证项） |
| 验证 | 内联自评 | 验证流水线（XML验证 + 自评 + 审计） |
| 会话状态 | 仅 `_todo.json` | `STATE.md` + `_state.json`（决策/统计/交接） |
| 上下文注入 | 写作时才读 read_plan | 预加载精准注入（省去 3 次工具调用） |
