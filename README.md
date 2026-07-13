# Novel-Agent 📖

面向长篇原创与同人短篇的人机协作创作工程，支持多模型路由、流式输出和可恢复状态。

项目仓库：[github.com/catherine9898momo/novel-agent](https://github.com/catherine9898momo/novel-agent)

## 当前能力

| 创作模式 | 当前状态 | 已有能力 |
|---|---|---|
| 同人短篇 | 可运行闭环 | 创意解析、Canon 约束、计划、草稿、审阅、改写、人工接受、状态机、CLI、本地 UI/API、事件指标 |
| 长篇原创 | 工程化工具链 | 项目初始化、大纲与人物设定、章节管理、上下文压缩、分析、审阅、连贯性审计、多模型路由 |

同人短篇已经具备可恢复的端到端流程：

`用户创意 → 故事卡与 Canon → 人工确认 → 计划 → 人工确认 → 草稿 → 审阅 → 改写 → 人工接受 → 终稿`

长篇链路仍沿用现有入口，尚未与短篇共享统一的项目模型和 `continue` 编排器。

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 API Key

复制配置模板：
```bash
cp .env.example .env
```

编辑 `.env`，填入你的 API Key：
```bash
# 必填：至少配置一个 API Key
ANTHROPIC_API_KEY=sk-xxx           # Claude API Key
ANTHROPIC_BASE_URL=https://api.anthropic.com  # 可选，代理地址

# 可选：为不同角色配置不同模型
PLAN_API_KEY=your-zhipu-token      # 规划用智谱 GLM
PLAN_BASE_URL=https://open.bigmodel.cn/api/anthropic
PLAN_MODEL=glm-5.1
```

### 3. 运行同人短篇工作台

```bash
npm run preview:fanfic-ui
```

打开终端输出的本地地址，即可从创意输入开始，逐步确认故事卡、计划、草稿和终稿。工作台默认写入 `fanfics-ui-local/`，可通过 `FANFIC_ROOT` 覆盖。

也可以使用 CLI：

```bash
npm run fanfic -- init rain-letter
npm run fanfic -- continue rain-letter --idea "一个短篇同人创意"
npm run fanfic -- status rain-letter
```

`continue` 只自动执行安全步骤，并在需要人工审批时停止。确认动作通过显式命令执行：

```bash
npm run fanfic -- run rain-letter approve_idea
npm run fanfic -- continue rain-letter
```

### 4. 创建长篇小说

```bash
npm start -- 我的小说名
```

首次运行会：
1. 在 `novels/我的小说名/` 创建目录
2. 引导你填写故事前提（premise）
3. 自动生成大纲、人物、关系、章节列表

### 5. 继续长篇创作

```bash
npm start -- 我的小说名
```

系统会自动检测进度，从上次中断的地方继续。

## 常用命令

| 命令 | 说明 |
|---|---|
| `npm start -- <小说名>` | 开始/继续长篇创作 |
| `npm run fanfic -- init <story_id>` | 初始化同人短篇项目 |
| `npm run fanfic -- continue <story_id>` | 自动推进到下一人工确认门 |
| `npm run fanfic -- status <story_id>` | 查看状态、下一动作和产物 |
| `npm run fanfic -- run <story_id> <command>` | 显式执行一条状态机命令 |
| `npm run preview:fanfic-ui` | 启动本地短篇工作台和 API |
| `npm run analyze -- <小说名>` | 分析已有长篇章节 |
| `npm run metrics:events -- <events.jsonl>` | 汇总工作流事件指标 |
| `npm run check` | 运行类型检查和完整测试 |
| `npm test` | 运行单元测试 |
| `npx vitest run tests/models-live.test.ts` | 测试 API 连通性 |

## 项目结构

```
novels/
└── 我的小说/
    ├── _premise.md       # 故事前提（用户设定）
    ├── _outline.md       # 故事大纲
    ├── _characters.md    # 人物设定
    ├── _relationships.md # 人物关系
    ├── _chapters.json    # 章节列表
    ├── STATE.md          # 进度状态
    └── chapters/
        ├── 001.md        # 第 1 章
        ├── 002.md        # 第 2 章
        └── ...
```

## 多模型路由

不同任务可以使用不同的模型，节省成本：

| 角色 | 用途 | 推荐模型 |
|------|------|----------|
| `write` | 正文创作 | Claude Sonnet |
| `plan` | 规划策划 | GLM-4 / Claude |
| `review` | 章节自评 | Claude Sonnet |
| `compress` | 上下文压缩 | MiniMax |
| `opus` | 关键章升级 | Claude Opus |

同人短篇可以使用 `FANFIC_PLAN_`、`FANFIC_WRITE_`、`FANFIC_REVIEW_` 和 `FANFIC_REWRITE_` 前缀覆盖对应模型；未配置时分别回退到通用的规划、写作和审阅端点。

配置方式：在 `.env` 中设置 `{ROLE}_MODEL`、`{ROLE}_API_KEY`、`{ROLE}_BASE_URL`。

## 人机协作 (HITL)

创作过程中，AI 会在关键节点询问你的意见：

- 大纲生成后 → 确认或修改
- 人物设定后 → 补充细节
- 每章写完后 → 审阅反馈

你可以：
- 输入 `y` 确认继续
- 输入 `n` 拒绝并说明原因
- 输入数字选择选项

同人短篇的人工确认门由状态机强制执行；自动 `continue` 不会替用户审批故事卡、计划、草稿或终稿。

## 同人短篇产物

```text
fanfics/rain-letter/
├── _state.json
├── _idea.json
├── _canon.json
├── _plan.json
├── _context/
├── _drafts/
├── _reviews/
└── final.md
```

状态转移、文件路径和人工确认门由工程代码控制；模型只负责解析或生成内容。

## 事件与指标

为同人短篇 CLI 指定事件日志后，`continue` 会写入 JSONL 事件：

```bash
FANFIC_METRICS_LOG=./fanfic-events.jsonl npm run fanfic -- continue rain-letter
npm run metrics:events -- ./fanfic-events.jsonl
```

## 当前限制

- 同人短篇状态机目前偏单向，尚不支持自然的多轮退回、重新打开和版本分支。
- 计划、草稿和终稿还没有统一的版本化编辑合同。
- 长篇与短篇尚未共享统一项目外壳和编排入口。
- 当前 UI/API 面向本地运行，不是已部署的在线服务。
- 素材召回、显式偏好和多轮 revision loop 属于下一阶段 P0 范围。

后续设计与边界见 [P0 统一创作工作台技术设计](./docs/P0_UNIFIED_CREATION_TECHNICAL_DESIGN.md)。

## 流式输出

创作时你会看到实时输出：

```
[规划] 生成 outline...
  🤔 思考中...        ← 思考动画
  12.3s ▮            ← 等待计时 + 闪烁光标
  我需要先了解...     ← 打字机效果
  🛠️ 准备调用: write_plan ✓
  ⏱️ 13.1s | 📝 1,234 tokens (500 in / 734 out) | ⚡ 56.2 t/s
```

## 开发

```bash
# 类型检查
npm run typecheck

# 运行测试
npm test

# 完整检查
npm run check
```

## 文档

- [ARCHITECTURE.md](./ARCHITECTURE.md) — 架构设计
- [CONCEPTS.md](./CONCEPTS.md) — 核心概念
- [.env.example](./.env.example) — 配置示例
- [同人短篇 MVP 需求](./docs/FANFIC_SHORT_STORY_MVP_REQUIREMENTS.md) — 短篇范围与实现阶段
- [同人短篇 UI 交互流程](./docs/FANFIC_UI_INTERACTION_FLOW.md) — 状态机、产物和本地 API
- [P0 统一创作工作台技术设计](./docs/P0_UNIFIED_CREATION_TECHNICAL_DESIGN.md) — 下一阶段统一方案

## 常见问题

**Q: API 调用失败怎么办？**

运行连通性测试诊断：
```bash
npx vitest run tests/models-live.test.ts
```

**Q: 如何修改已生成的规划？**

直接编辑 `novels/我的小说/_outline.md` 等文件，下次运行会读取更新。

**Q: 如何从头开始？**

删除 `novels/我的小说/` 目录重新运行。

## License

ISC
