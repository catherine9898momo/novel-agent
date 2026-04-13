# Novel Agent — 轻量工具集

> 核心理念：**创作环节靠人机对话，管理环节靠工程。**
>
> 写作在 IDE 中与 AI 对话完成（质量最高），工具集负责质量检测、AI 审阅、状态管理。

## 工作流

```
你定大纲/人设 → 你和 AI 对话写每一章 → 跑 metrics 检查质量
                                       → 跑 review 让 AI 审阅
                                       → 跑 analyze 分析全文状态
                                       → 跑 audit 检查跨章一致性
```

## 命令

```bash
npm run metrics <小说名> [章节号]    # 纯文本质量指标（无需 API）
npm run review  <小说名> <章节号>    # AI 审阅单章（需 API）
npm run analyze <小说名>             # AI 全文状态分析（需 API）
npm run audit   <小说名>             # AI 跨章连贯性审计（需 API）
npm test                             # 运行测试
```

## 项目结构

```
novel-agent/
├── src/
│   ├── main.ts              # CLI 入口（metrics/review/analyze/audit）
│   ├── types.ts             # 共享类型（ChapterMeta, NovelState）
│   ├── quality-metrics.ts   # 纯文本质量指标（无 LLM）
│   ├── novel-state.ts       # STATE.md 会话状态管理
│   ├── xml-plan.ts          # XML 结构化章节计划
│   ├── models.ts            # 多模型路由配置
│   ├── agents/
│   │   ├── reviewer.ts      # AI 审阅（自评 + 连贯性审计）
│   │   └── researcher.ts    # AI 分析（全文分析 + 声音提取）
│   └── providers/
│       ├── openai-compatible.ts
│       └── deepseek-web.ts
├── novels/
│   └── {小说标题}/
│       ├── _outline.md         # 故事大纲
│       ├── _characters.md      # 人物设定
│       ├── _relationships.md   # 人物关系
│       ├── _chapters.json      # 章节列表（含元数据）
│       ├── _story_so_far.md    # 累积故事摘要
│       ├── _foreshadowing.json # 伏笔追踪
│       ├── _voice_profiles.md  # 角色声音档案
│       ├── STATE.md            # 会话状态（人类可读）
│       └── 001-章节标题.md     # 章节正文
├── skills/styles/
│   └── ancient-romance.md      # 写作风格指南
└── tests/
```

## 质量指标（quality-metrics.ts）

纯文本分析，不调用 LLM，写完一章立即跑：

| 指标 | 说明 | 健康范围 |
|------|------|---------|
| dialogueRatio | 对话占比 | 0.3–0.6 |
| avgSentenceLength | 平均句长 | 15–30 |
| sentenceLengthCV | 句长变异系数 | >0.3（越高节奏越丰富） |
| paragraphLengthCV | 段落变异系数 | >0.3 |
| tabooPhraseDensity | 模板禁忌词密度 | 0（越低越好） |
| explicitThoughtDensity | 直白心理描写密度 | 0（越低越好） |
| repeatedPhrases | 重复短语 | 需人工判断 |
| exclamationDensity | 感叹号密度 | <0.5/百字 |
| adverbDensity | 副词密度 | <0.5/百字 |

## AI 审阅（reviewer.ts）

- **reviewChapter()** — 单章自评，输出 1-5 分 + 6 维度评分 + weak_spots 精确标记
- **verifyAgainstPlan()** — 对照 XML 章节计划验证场景覆盖、伏笔操作
- **runCoherenceAudit()** — 跨章连贯性审计（时间线、称呼、伏笔、逻辑）

## AI 分析（researcher.ts）

- **runAnalysisAgent()** — 全文分析，输出故事摘要、伏笔清单、断点分析
- **extractVoiceProfiles()** — 从已写章节提取角色声音档案
- **loadExistingChaptersText()** — 加载已有章节文本

## 模型配置

通过环境变量配置（见 `.env.example`），支持 Anthropic / OpenAI Compatible / DeepSeek：

| 角色 | 用途 | 建议模型 |
|------|------|---------|
| REVIEW | 章节审阅 | Claude Sonnet |
| AUDIT | 全文分析/连贯性审计 | Claude Sonnet |
| EXTRACT | 声音档案提取 | 轻量模型 |
