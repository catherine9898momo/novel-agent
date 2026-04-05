# Novel-Agent 📖

AI 驱动的长篇小说创作助手，支持多模型路由、流式输出、人机协作。

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

### 3. 创建小说

```bash
npm start 我的小说名
```

首次运行会：
1. 在 `novels/我的小说名/` 创建目录
2. 引导你填写故事前提（premise）
3. 自动生成大纲、人物、关系、章节列表

### 4. 继续创作

```bash
npm start 我的小说名
```

系统会自动检测进度，从上次中断的地方继续。

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm start <小说名>` | 开始/继续创作 |
| `npm run analyze <小说名>` | 分析已有章节 |
| `npm run verify` | 验证模式（无需 API Key） |
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

## 验证模式

无需 API Key 即可测试完整流程：

```bash
npm run verify
```

会使用 Mock 数据模拟所有 API 调用，生成验证报告。

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
npx tsc --noEmit

# 运行测试
npm test

# 监听模式
npm run test:watch
```

## 文档

- [ARCHITECTURE.md](./ARCHITECTURE.md) — 架构设计
- [CONCEPTS.md](./CONCEPTS.md) — 核心概念
- [.env.example](./.env.example) — 配置示例

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
