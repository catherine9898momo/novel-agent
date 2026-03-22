# Novel Agent — 功能与架构文档

## 功能概览

| 功能 | 说明 |
|------|------|
| 多部小说管理 | CLI 参数直接指定，或交互菜单列出 `novels/` 下所有目录 |
| 状态自动检测 | 启动时扫描小说目录，判断缺少哪些规划文件和章节 |
| 逆向提取规划 | 已有章节但无规划时，基于已有章节内容推断大纲/人物/关系 |
| HITL 确认 | 每个规划产物生成后暂停，用户可输入 `y` 确认或输入反馈重新生成 |
| 故事记忆 | 每章写完后更新 `_story_so_far.md`，下一章注入摘要 + 上章结尾 600 字 |
| 任务持久化 | `_todo.json` 记录每章状态，重启后自动续写未完成章节 |
| 上下文压缩 | 三层策略防止 token 超限（微压缩 / 自动摘要 / LLM 主动压缩） |
| 全文分析 | 有已写章节但缺少摘要或元数据时，单次 LLM 调用重建故事状态（摘要、伏笔、断点、章节元数据） |
| 缺失章节处理 | 检测章节空洞，用户选择补写 / 跳过 / 标记番外，结果写入 `_skip_chapters.json` |

---

## 整体架构

```
novel-agent/
├── src/
│   ├── novel-agent.ts      # 主入口：小说选择、状态检测、规划、写作
│   ├── agent-loop.ts       # 核心 Agent 循环（工具调用驱动）
│   ├── tools.ts            # 工具定义（说明书）+ 工具实现（handler）
│   ├── todo.ts             # 任务列表：内存管理 + 文件持久化
│   └── context-compact.ts  # 上下文压缩：三层策略
├── novels/
│   └── {小说标题}/
│       ├── _outline.md         # 故事大纲
│       ├── _characters.md      # 人物设定
│       ├── _relationships.md   # 人物关系
│       ├── _chapters.json      # 章节列表（含元数据）
│       ├── _todo.json          # 任务状态（持久化）
│       ├── _story_so_far.md    # 累积故事摘要
│       ├── _skip_chapters.json # 用户选择跳过的章节编号
│       └── 001-章节标题.md     # 章节正文
└── skills/styles/
    └── ancient-romance.md      # 写作风格指南
```

### 模块职责

```
novel-agent.ts
    │
    ├── selectNovel()        选择或新建小说
    ├── detectState()        扫描目录，返回 NovelState（含 hasStorySoFar / chaptersHaveMetadata）
    ├── hitlGate()           HITL 确认循环
    ├── runPlanAgent()       规划 subagent（outline/characters/relationships）
    ├── runChapterProposalAgent()  章节列表 subagent
    ├── runAnalysisAgent()   全文分析 subagent（重建摘要/元数据/伏笔/断点）
    └── main()               主流程编排
            │
            └── agentLoop()  ← agent-loop.ts
                    │
                    ├── Anthropic API
                    ├── ToolHandlers  ← tools.ts
                    └── CompactOptions ← context-compact.ts
```

---

## 功能流程图

### 1. 主流程

```
启动
  │
  ▼
selectNovel()
  有 CLI 参数? ──是──▶ 使用参数值
  │否
  ▼
列出 novels/ 目录
  │
  ▼
用户选择 / 新建
  │
  ▼
detectState(novelDir)
  │
  ├─ hasOutline / hasCharacters / hasRelationships / hasChapters
  └─ existingChapterNums
  │
  ▼
┌─────────────────────────────┐
│        阶段一：规划          │
└─────────────────────────────┘
  │
  ▼
for each missing in [outline, characters, relationships]
  │
  ├── runPlanAgent(type)  →  write_plan 工具保存文件
  │
  └── hitlGate(type)
        │
        ├── 用户输入 y  ──▶ 继续下一项
        └── 用户输入反馈 ──▶ runPlanAgent(type, feedback) ──▶ 再次确认
  │
  ▼
_chapters.json 存在?
  │否
  ▼
runChapterProposalAgent()  →  propose_chapters 工具保存
  │
  └── hitlGate("章节列表")
  │
  ▼
┌─────────────────────────────────────────┐
│        阶段一·五：全文分析（按需）        │
└─────────────────────────────────────────┘
  │
  ▼
detectState() → !hasStorySoFar || !chaptersHaveMetadata?
  │是
  ▼
runAnalysisAgent()
  ├── 读取所有已写章节
  ├── 输出：故事摘要 / 章节元数据 / 伏笔清单 / 断点分析
  ├── hitlGate("全文分析")
  └── 写入 _story_so_far.md + _chapters.json（含元数据）
  │
  ▼
检测章节空洞（_skip_chapters.json）
  └── 用户选择：补写 / 跳过 / 标记番外
  │
  ▼
┌─────────────────────────────┐
│        阶段二：写作          │
└─────────────────────────────┘
  │
  ▼
加载 / 恢复 TodoList（_skip_chapters 自动标 done）
  │
  ▼
for each pending chapter
  │
  ├── 读取 _story_so_far.md（故事摘要）
  ├── 读取上一章结尾 600 字
  │
  └── agentLoop(chapterSystem)
        │
        ├── read_plan × 3（outline/characters/relationships）
        ├── write_chapter（保存正文）
        ├── write_story_so_far（更新摘要）
        └── update_todo（标记 done）
  │
  ▼
所有章节完成 → 退出
```

---

### 2. Agent Loop（核心循环）

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
for each tool_use block in response
  │
  ├── handlers[tool.name](tool.input)
  └── 收集 tool_result
  │
  ▼
messages.push(tool_results)
  │
  ▼
压缩检查（CompactOptions）
  ├── microCompress：截断旧 tool_result（保留最近 3 条）
  └── autoCompress：超过 80k token 时 LLM 摘要替换历史
  │
  ▼
回到顶部继续循环
```

---

### 3. HITL 确认流程

```
hitlGate(label, getContent, regenerate)
  │
  ▼
getContent()  →  读取刚生成的文件内容
  │
  ▼
打印内容到终端
  │
  ▼
askLine("确认？(y / 输入修改意见)")
  │
  ├── 输入 y ──▶ return（通过）
  │
  └── 输入其他文字
          │
          ▼
        regenerate(feedback)  →  agent 重新生成并保存
          │
          ▼
        回到顶部（再次展示 + 等待确认）
```

---

### 4. 上下文压缩三层策略

```
每轮 tool_results push 后触发：

Layer 1: microCompress（同步，无 API 调用）
  └── 旧 tool_result 截断到 100 字符，保留最近 3 条完整

Layer 2: autoCompress（异步，调用 LLM）
  └── estimateTokens > 80k?
        │是
        └── LLM 生成摘要 → 替换整个 messages 数组

Layer 3: compact 工具（LLM 主动触发）
  └── LLM 感觉上下文过长时调用 compact 工具
        └── 触发 autoCompress
```

---

### 5. 工具清单

| 工具 | 用途 | 调用方 |
|------|------|--------|
| `write_plan` | 保存 outline/characters/relationships | 规划 agent |
| `read_plan` | 读取规划文件 | 写作 agent |
| `propose_chapters` | 提交章节列表 | 规划 agent |
| `write_chapter` | 保存章节正文（幂等） | 写作 agent |
| `read_chapter` | 读取已有章节 | 写作 agent |
| `list_chapters` | 列出已完成章节 | 写作 agent |
| `write_story_so_far` | 更新累积故事摘要 | 写作 agent |
| `read_story_so_far` | 读取故事摘要 | 写作 agent |
| `update_todo` | 更新任务状态 | 写作 agent |
| `compact` | 主动触发上下文压缩 | 任意 agent |
