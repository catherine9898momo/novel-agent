# Novel Agent 中文 STAR 案例重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 Novel Agent Career Capture 面试案例重构为中文 STAR 主叙事，同时保留完整技术证据和 `needs_metrics` 边界。

**Architecture:** 只修改现有案例文件，在标题后插入中文 STAR 主体，原技术章节继续作为证据附录。案例 ID、commit 证据、主题索引和 index 结构保持不变。

**Tech Stack:** Markdown、Career Capture frontmatter、Vitest、TypeScript。

## Global Constraints

- 案例正文、STAR 标题、追问和回答全部使用中文。
- 只保留 commit、Git Hook、CLI、pending、index 等必要技术标识。
- 不创建第二份案例，不新增 index entry。
- 不虚构节省时间、准确率、面试结果或生产性能指标。
- 保持 `evidenceStatus: needs_metrics`。
- 未经用户确认，不提交案例改动。

---

### Task 1: 重构中文 STAR 主叙事

**Files:**
- Modify: `career-prepare/novel-agent/cases/2026-07-11-career-capture-reliability.md`
- Verify: `tests/career-*.test.ts`

**Interfaces:**
- Consumes: 现有 frontmatter、提交 `1f2af16bfbbff6360e9b84a1a3998a5ddf862ec2`、已验证的测试与 doctor 结果。
- Produces: 保持同一 `caseId` 的中文 STAR 面试案例。

- [ ] **Step 1: 保留 frontmatter 和证据边界**

确认以下字段不变：

```yaml
caseId: 2026-07-11-career-capture-reliability
commitHashes: ["1f2af16bfbbff6360e9b84a1a3998a5ddf862ec2"]
topics: ["reliability", "human-in-the-loop", "testing", "state-machine"]
evidenceStatus: needs_metrics
```

- [ ] **Step 2: 在标题后写入中文 STAR 主体**

使用以下固定结构：

```markdown
## STAR 面试叙事

### S｜情境

说明为什么需要自动沉淀工程案例，以及 Git 提交与 AI 交互处于不同可靠性边界。

### T｜任务

说明需要实现非阻塞、可恢复、去重、安全且必须由用户确认的工作流。

### A｜行动

按“拆分边界—比较方案—状态设计—证据安全—人工确认—真实测试”的顺序描述实现。

### R｜结果

#### 已验证

只写 Hook 非阻塞、恢复去重、根提交修复、doctor 和测试结果。

#### 待验证

保留效率收益、误报率、生产延迟和面试复用效果等未测指标。
```

- [ ] **Step 3: 让简短回答遵循同一 STAR 顺序**

重写 `60 秒回答` 和 `3 分钟回答`，都按“情境 → 任务 → 行动 → 结果”展开；结果必须同时说明已验证事实和 `needs_metrics` 项。

- [ ] **Step 4: 检查中文结构与重复内容**

Run:

```bash
rg -n '^## STAR 面试叙事|^### S｜情境|^### T｜任务|^### A｜行动|^### R｜结果|^#### 已验证|^#### 待验证' career-prepare/novel-agent/cases/2026-07-11-career-capture-reliability.md
```

Expected: 七个 STAR 标题各出现一次，且正文没有新增英文叙事段落。

- [ ] **Step 5: 运行 Career Capture 回归验证**

Run:

```bash
npx vitest run tests/career-*.test.ts
npm run typecheck
git diff --check
```

Expected: Career Capture 测试全部通过，TypeScript 退出 0，`git diff --check` 无输出。

- [ ] **Step 6: 等待提交确认**

展示重构后的案例文件和验证结果。只有用户明确确认后，才把案例、主题索引、index 和相关测试修正一起提交。
