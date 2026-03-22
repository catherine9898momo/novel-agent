# Agent 核心概念详解（伪代码版）

本文档用伪代码和图示解释 s01-s12 的核心思想，不涉及具体语言语法。

---

## s01: Agent Loop - 一切的起点

**解决的问题：** 让 LLM 能"动手做事"，而不只是"说话"

**核心机制：**

```
用户: "列出当前目录的文件"
  ↓
┌─────────────────────────────────────────┐
│  LLM 思考: 我需要执行 ls 命令           │
│  返回: { tool: "bash", command: "ls" } │
└─────────────────────────────────────────┘
  ↓
你的代码执行 ls，得到结果: "file1.txt file2.txt"
  ↓
把结果喂回给 LLM
  ↓
┌─────────────────────────────────────────┐
│  LLM: 当前目录有 file1.txt 和 file2.txt │
│  返回: 纯文本（没有工具调用）            │
└─────────────────────────────────────────┘
  ↓
循环结束，输出给用户
```

**伪代码：**

```
function agentLoop(messages):
    while true:
        response = 调用LLM(messages)
        messages.push(response)

        if response.没有调用工具:
            return  // 结束

        for each 工具调用 in response:
            result = 执行工具(工具调用)
            messages.push(result)

        // 继续循环，把结果喂回去
```

**一句话总结：** 调用 → 执行 → 喂回 → 重复，直到 LLM 不再需要工具

---

## s02: Tool Dispatch - 多个工具

**解决的问题：** s01 只有 bash 一个工具，真实场景需要多个

**核心机制：**

```
工具注册表 = {
    "bash":       执行命令的函数,
    "read_file":  读文件的函数,
    "write_file": 写文件的函数,
    "edit_file":  编辑文件的函数,
}

当 LLM 返回 { tool: "read_file", path: "a.txt" }:
    找到 工具注册表["read_file"]
    调用它
```

**伪代码：**

```
// 定义工具处理器
const handlers = {
    bash:       (args) => 执行命令(args.command),
    read_file:  (args) => 读文件(args.path),
    write_file: (args) => 写文件(args.path, args.content),
}

// 循环里的执行部分
for each 工具调用 in response:
    handler = handlers[工具调用.name]
    result = handler(工具调用.args)
```

**一句话总结：** 循环不变，只是加了一个路由表来分发不同工具

---

## s03: TodoWrite - 让 Agent 自己跟踪进度

**解决的问题：** 复杂任务时，Agent 容易忘记自己做到哪了

**核心机制：**

```
给 LLM 一个 "todo" 工具，让它自己维护任务列表：

LLM 调用: todo.update([
    { text: "读取配置文件", status: "completed" },
    { text: "修改端口号",   status: "in_progress" },
    { text: "重启服务",     status: "pending" },
])

你的代码保存这个状态，并显示给用户：
[x] 读取配置文件
[>] 修改端口号
[ ] 重启服务
```

**额外机制 - 提醒：**

```
if 连续3轮没更新todo:
    在消息里插入: "<reminder>更新一下你的进度</reminder>"
```

**一句话总结：** 给 Agent 一个"记事本"工具，让它自己记录进度

---

## s04: Subagent - 子任务隔离

**解决的问题：** 上下文会越来越长，而且子任务的细节会污染主对话

**核心机制：**

```
主 Agent                          子 Agent
messages = [很多历史...]          messages = []  ← 全新的！
    │                                 │
    │  "帮我调研一下 X 技术"          │
    └──────────────────────────────→ │
                                      │ 独立工作...
                                      │ 调用工具...
                                      │ 可能有 20 轮对话
                                      │
    ┌──────────────────────────────←─┘
    │  只返回: "调研结果摘要"
    │
主 Agent 继续，上下文保持干净
```

**伪代码：**

```
function runSubagent(prompt):
    subMessages = [{ role: "user", content: prompt }]  // 全新上下文

    while true:
        response = 调用LLM(subMessages)
        if response.没有调用工具:
            return response.text  // 只返回最终文本
        // ... 执行工具，继续循环

    // 子 agent 的 subMessages 在这里被丢弃
```

**一句话总结：** 子任务用独立上下文，完成后只返回摘要，主对话保持干净

---

## s05: Skill Loading - 按需加载知识

**解决的问题：** 不能把所有知识都塞进 system prompt，太长了

**核心机制：**

```
System Prompt (精简):
"你是一个 coding agent。
 可用技能: pdf处理, 代码审查, 数据库操作
 需要时调用 load_skill 获取详细指令"

当 LLM 需要处理 PDF 时:
    LLM 调用: load_skill("pdf")
    ↓
    返回完整的 PDF 处理指南（可能有 500 行）
    ↓
    LLM 按照指南操作
```

**一句话总结：** 目录放 system prompt，正文按需加载到 tool_result

---

## s06: Context Compact - 上下文压缩

**解决的问题：** 对话太长，超出 token 限制

**三层压缩：**

```
Layer 1 - 微压缩（每轮自动）:
    旧的工具结果 → "[之前: 用了 bash]"
    只保留最近 3 个完整结果

Layer 2 - 自动压缩（超过阈值时）:
    保存完整记录到文件
    让 LLM 总结对话
    用摘要替换所有历史

Layer 3 - 手动压缩:
    Agent 自己调用 compact 工具触发压缩
```

**一句话总结：** 策略性遗忘，让 Agent 能无限工作下去

---

## s07: Task System - 持久化任务

**解决的问题：** 上下文压缩后，任务状态丢失了

**核心机制：**

```
任务存在文件里，不在对话里：

.tasks/
  task_1.json  { id: 1, subject: "...", status: "completed" }
  task_2.json  { id: 2, subject: "...", status: "pending", blockedBy: [1] }

即使对话被压缩，任务状态还在
Agent 可以随时读取 task_list 恢复上下文
```

**一句话总结：** 重要状态存文件，不依赖对话历史

---

## s08: Background Tasks - 后台执行

**解决的问题：** 长时间命令（如 npm install）会阻塞 Agent

**核心机制：**

```
主线程                    后台线程
   │
   │ background_run("npm install")
   │────────────────────→ 开始执行
   │                         │
   │ 立即返回 task_id        │
   │ 继续做其他事...         │ 还在跑...
   │                         │
   │ ←─────────────────── 完成，放入通知队列
   │
下次 LLM 调用前，检查队列，注入通知
```

**一句话总结：** 耗时操作扔后台，Agent 不阻塞

---

## s09: Agent Teams - 多 Agent 协作

**解决的问题：** 一个 Agent 忙不过来

**核心机制：**

```
Lead Agent (主线程)
    │
    ├── spawn("alice", "前端开发")  → Alice 线程启动
    ├── spawn("bob", "后端开发")    → Bob 线程启动
    │
    │   通过文件消息队列通信:
    │   .team/inbox/alice.jsonl
    │   .team/inbox/bob.jsonl
    │
    └── send_message("alice", "做登录页面")
            ↓
        Alice 收到消息，开始工作
```

**一句话总结：** 多个 Agent 各自独立运行，通过消息队列通信

---

## s10: Team Protocols - 协作协议

**解决的问题：** 多 Agent 需要有规范的交互方式

**核心机制：**

```
关机协议:
    Lead → Alice: { type: "shutdown_request", request_id: "abc" }
    Alice → Lead: { type: "shutdown_response", request_id: "abc", approve: true }
    Lead 收到确认后，Alice 才真正关闭

计划审批协议:
    Alice → Lead: { type: "plan_approval", plan: "我打算..." }
    Lead → Alice: { type: "plan_response", approve: true/false }
```

**一句话总结：** 用 request_id 关联请求和响应，实现可靠的多 Agent 协调

---

## s11: Autonomous Agents - 自主 Agent

**解决的问题：** 每次都要 Lead 分配任务太麻烦

**核心机制：**

```
Agent 生命周期:
    spawn → 工作 → 空闲 → 轮询 → 工作 → ... → 超时关闭
                      ↓
              每 5 秒检查:
              1. 收件箱有消息？→ 处理
              2. 任务板有未认领任务？→ 抢占
              3. 空闲超过 60 秒？→ 自动关闭
```

**一句话总结：** Agent 自己找活干，不需要人分配

---

## s12: Worktree Isolation - 目录隔离

**解决的问题：** 多个 Agent 同时改代码会冲突

**核心机制：**

```
用 Git Worktree 给每个任务独立目录:

主仓库: /project
    │
    ├── .worktrees/
    │   ├── feature-login/   ← Agent A 在这里工作
    │   └── fix-bug-123/     ← Agent B 在这里工作
    │
    └── 互不干扰，最后合并
```

**一句话总结：** 每个任务一个目录，并行不冲突

---

## 总结：12 个概念的递进关系

```
s01 基础循环
 ↓
s02 多工具 ← 扩展能力
 ↓
s03 进度跟踪 ← 自我管理
 ↓
s04 子任务隔离 ← 上下文管理
 ↓
s05 按需加载 ← 知识管理
 ↓
s06 上下文压缩 ← 无限对话
 ↓
s07 任务持久化 ← 状态管理
 ↓
s08 后台执行 ← 并发
 ↓
s09 多Agent ← 团队协作
 ↓
s10 协作协议 ← 规范通信
 ↓
s11 自主Agent ← 去中心化
 ↓
s12 目录隔离 ← 并行安全
```

---

## 下一步

理解了这些概念后，可以用 TypeScript 实现 s01-s04，这是最核心的部分。
