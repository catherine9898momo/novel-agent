# Novel Agent 渐进搭建计划与进度

## 整体目标

用 Anthropic SDK 从零搭建一个能自主写长篇小说的 AI Agent，核心能力：
- 自主调用工具（读5i am sorry about/写文件）
- 用 todo list 追踪多章节写作进度
- 通过风格指南（skills）控制写作风格

---

## 搭建步骤

### Step 1 — Agent 核心循环 ✅

**目标**：实现最小可用的 agent loop，能让 LLM 反复调用工具直到任务完成。

**产出**：`src/agent-loop.ts`

关键逻辑：
```
while stop_reason == "tool_use":
    response = LLM(messages, tools)
    execute tools
    append results to messages
```

**验证方式**：
```bash
# TypeScript 类型检查通过，无报错
cd novel-agent && node_modules/.bin/tsc --noEmit
```

---

### Step 2 — 工具定义与执行 ✅

**目标**：定义 agent 能使用的工具，并实现其执行逻辑。

**产出**：`src/tools.ts`

三个工具：
| 工具 | 作用 |
|------|------|
| `write_chapter` | 将章节内容写入 `novels/<书名>/` 目录 |
| `read_chapter` | 读取已写章节，保持剧情连贯 |
| `list_chapters` | 列出所有已完成章节 |

**验证方式**：
```bash
# 检查 novels/ 目录下是否生成了对应 md 文件
ls novels/<书名>/
```

---

### Step 3 — Todo List 任务追踪 ✅

**目标**：让 agent 知道"还有哪些章节没写"，避免遗漏或重复。

**产出**：`src/todo.ts`

机制：内存数组 + 注入 system prompt，LLM 每轮都能看到当前进度。

状态流转：`pending` → `in_progress` → `done`

**验证方式**：
```typescript
const todo = new TodoList();
todo.add(["第一章", "第二章"]);
console.log(todo.toPromptString());
// ⬜ [1] 第一章
// ⬜ [2] 第二章
```

---

### Step 4 — 主入口与 Skills 注入 ✅

**目标**：把所有模块串起来，并通过外部 md 文件注入写作风格（skills 概念）。

**产出**：`src/novel-agent.ts`

流程：
1. 读取 `skills/styles/<风格>.md` → 注入 system prompt
2. 初始化 todo list（章节列表）
3. 启动 agent loop

**验证方式**：
```bash
npm start
# 控制台应输出：开始创作《...》，共 N 章...
# 每次工具调用打印：[工具] write_chapter: 第1章...已保存
```

---

### Step 5 — 古言言情风格指南 ✅

**目标**：基于真实作品分析，提炼可复用的写作风格指南。

**产出**：`skills/styles/ancient-romance.md`

参考作品：《长公主病入膏肓后》《难为鸾帐恩》

涵盖：语言风格、人物塑造、情感节奏、心理描写、场景描写、叙事结构、禁忌。

**验证方式**：
```bash
# 修改 novel-agent.ts 中的 style 字段
const style = "ancient-romance";
npm start
# 观察生成内容是否符合古言风格
```

---

### Step 6 — 多部小说管理 + 状态自动检测 ✅

**目标**：支持多部小说并行管理，启动时自动判断当前进度。

**产出**：`src/novel-agent.ts` — `selectNovel()` / `detectState()`

机制：
- CLI 参数直接指定书名，或交互菜单列出 `novels/` 下所有目录
- `detectState()` 扫描目录，返回 `NovelState`（hasOutline / hasCharacters / hasRelationships / hasChapters / existingChapterNums）

---

### Step 7 — 规划 Agent + HITL 确认 ✅

**目标**：自动生成大纲、人物、关系，每步暂停等待用户确认或反馈。

**产出**：`src/novel-agent.ts` — `runPlanAgent()` / `runChapterProposalAgent()` / `hitlGate()`

工具：
| 工具 | 作用 |
|------|------|
| `write_plan` | 保存 outline/characters/relationships |
| `read_plan` | 读取规划文件 |
| `propose_chapters` | 提交章节列表 |

---

### Step 8 — 故事记忆 ✅

**目标**：防止长篇写作中剧情断层。

**产出**：`_story_so_far.md` + `write_story_so_far` / `read_story_so_far` 工具

机制：每章写完后更新累积摘要，下一章 system prompt 注入摘要 + 上章结尾 600 字。

---

### Step 9 — 任务持久化 ✅

**目标**：进程重启后自动续写未完成章节。

**产出**：`src/todo.ts` — 内存管理 + `_todo.json` 文件持久化

状态流转：`pending` → `in_progress` → `done`，重启后从文件恢复。

---

### Step 10 — 上下文压缩 ✅

**目标**：防止长篇写作中 token 超限。

**产出**：`src/context-compact.ts`

三层策略：
| 层级 | 触发条件 | 操作 |
|------|----------|------|
| microCompress | 每轮 | 旧 tool_result 截断到 100 字符，保留最近 3 条完整 |
| autoCompress | estimateTokens > 80k | LLM 生成摘要替换整个 messages 数组 |
| compact 工具 | LLM 主动触发 | 触发 autoCompress |

---

### Step 11 — 逆向提取规划 ✅

**目标**：已有章节但无规划文件时，基于已有内容推断大纲/人物/关系，无缝接入写作流程。

**产出**：`src/novel-agent.ts` — `runPlanAgent()` 逆向模式

机制：`detectState()` 检测到有章节但缺规划时，读取已有章节内容作为上下文，让 LLM 反推规划文件。

---

### Step 12 — 全文分析 + 缺失章节处理 ✅

**目标**：有已写章节但缺少摘要或元数据时，单次 LLM 调用重建故事状态；检测章节空洞并让用户决策。

**产出**：`src/novel-agent.ts` — `runAnalysisAgent()`；`_skip_chapters.json`

`detectState()` 新增字段：
- `hasStorySoFar` — 是否存在 `_story_so_far.md`
- `chaptersHaveMetadata` — `_chapters.json` 第一个元素是否为对象（含元数据）

分析输出四块：故事摘要 / 章节元数据 / 伏笔清单 / 断点分析，HITL 确认后写入文件。

缺失章节给出三选一：补写 / 跳过 / 标记番外，结果写入 `_skip_chapters.json`，todo 初始化时自动标 done。

---

## 当前状态

| 模块 | 文件 | 状态 |
|------|------|------|
| Agent 循环 | `src/agent-loop.ts` | ✅ 完成 |
| 工具层 | `src/tools.ts` | ✅ 完成 |
| Todo 追踪 | `src/todo.ts` | ✅ 完成 |
| 上下文压缩 | `src/context-compact.ts` | ✅ 完成 |
| 主入口 | `src/novel-agent.ts` | ✅ 完成 |
| 古言风格指南 | `skills/styles/ancient-romance.md` | ✅ 完成 |

> TypeScript 零错误，端到端流程已验证（《沈清辞-萧衍》第 1-9 章已写，第 10 章起自动续写）。
