/**
 * verify/mock-api.ts - Mock Anthropic 客户端
 *
 * 拦截所有 client.messages.create() 调用，根据 prompt 内容推断 agent 类型，
 * 返回结构化的 mock 响应，驱动 agentLoop 和直接调用完成全流程。
 *
 * 两类调用模式：
 *   1. agentLoop 多轮调用（有 tools 参数）：
 *      - 第一轮：返回 tool_use 块
 *      - 后续轮：返回 text + end_turn
 *   2. 直接调用（无 tools 参数）：
 *      - 返回 text（JSON 或自由文本）
 */

import { report } from "./report.js";

// ── 类型定义（兼容 Anthropic SDK 响应格式）───────────────

interface MockTextBlock {
  type: "text";
  text: string;
}

interface MockToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

type MockContentBlock = MockTextBlock | MockToolUseBlock;

interface MockResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: MockContentBlock[];
  model: string;
  stop_reason: "end_turn" | "tool_use";
  stop_sequence: null;
  usage: { input_tokens: number; output_tokens: number };
}

// ── Mock Messages 类 ──────────────────────────────────────

let globalToolId = 0;
function nextToolId(): string {
  return `toolu_mock_${++globalToolId}`;
}

// ── MockStream（兼容 agentLoop 的 for-await + finalMessage）──

interface MockStreamEvent {
  type: string;
  content_block?: { type: string; id?: string; name?: string };
  delta?: { type: string; text?: string; partial_json?: string };
}

class MockStream {
  private blocks: MockContentBlock[];
  private model: string;

  constructor(blocks: MockContentBlock[], model: string) {
    this.blocks = blocks;
    this.model = model;
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<MockStreamEvent> {
    yield { type: "message_start" };

    for (const block of this.blocks) {
      if (block.type === "tool_use") {
        yield {
          type: "content_block_start",
          content_block: { type: "tool_use", id: block.id, name: block.name },
        };
        yield {
          type: "content_block_delta",
          delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) },
        };
        yield { type: "content_block_stop" };
      } else {
        yield {
          type: "content_block_start",
          content_block: { type: "text" },
        };
        yield {
          type: "content_block_delta",
          delta: { type: "text_delta", text: block.text },
        };
        yield { type: "content_block_stop" };
      }
    }
  }

  async finalMessage(): Promise<MockResponse> {
    const hasToolUse = this.blocks.some(b => b.type === "tool_use");
    return {
      id: `msg_mock_${Date.now()}`,
      type: "message",
      role: "assistant",
      content: this.blocks,
      model: this.model,
      stop_reason: hasToolUse ? "tool_use" : "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 50 },
    };
  }
}

class MockMessages {
  private roleName: string;

  constructor(roleName: string) {
    this.roleName = roleName;
  }

  /**
   * Mock stream() — 返回一个对象，兼容 agentLoop 和 generateOpeningVariants。
   * 模拟 Anthropic SDK 的 MessageStream：async iterable + finalMessage()。
   */
  stream(params: {
    model?: string;
    system?: string;
    messages: Array<{ role: string; content: unknown }>;
    tools?: unknown[];
    max_tokens?: number;
  }): MockStream {
    const hasTools = !!(params.tools && params.tools.length > 0);
    const hasToolResults = this.containsToolResults(params.messages);
    const agentType = this.detectAgentType(params.system ?? "", params.messages);

    // 记录 API 调用
    report.recordApiCall({
      timestamp: Date.now(),
      role: this.roleName,
      agentType,
      isAgentLoop: hasTools,
      isFollowUp: hasToolResults,
      systemPromptPreview: (params.system ?? "").slice(0, 200).replace(/\n/g, " "),
      userMessagePreview: this.extractUserMessage(params.messages).slice(0, 200),
      responseType: "text",
      toolsCalled: [],
      durationMs: 0,
    });

    if (hasTools && !hasToolResults) {
      // agentLoop 第一轮：返回工具调用
      const toolBlocks = this.generateToolCalls(agentType, params);
      for (const block of toolBlocks) {
        if (block.type === "tool_use") {
          report.recordToolCall({
            toolName: block.name,
            inputPreview: JSON.stringify(block.input).slice(0, 150),
            outputPreview: "(pending execution by handler)",
          });
        }
      }
      return new MockStream(toolBlocks, params.model ?? "mock-model");
    } else if (hasTools && hasToolResults) {
      // agentLoop 后续轮：结束循环
      const text = this.getCompletionText(agentType);
      return new MockStream([{ type: "text", text }], params.model ?? "mock-model");
    } else {
      // 直接调用（generateOpeningVariants 等）
      const directResponse = this.generateDirectResponse(agentType, params);
      return new MockStream([{ type: "text", text: directResponse }], params.model ?? "mock-model");
    }
  }

  async create(params: {
    model?: string;
    system?: string;
    messages: Array<{ role: string; content: unknown }>;
    tools?: unknown[];
    max_tokens?: number;
  }): Promise<MockResponse> {
    const start = Date.now();
    const hasTools = !!(params.tools && params.tools.length > 0);
    const hasToolResults = this.containsToolResults(params.messages);

    // 推断 agent 类型
    const agentType = this.detectAgentType(params.system ?? "", params.messages);

    let content: MockContentBlock[];
    let stopReason: "end_turn" | "tool_use";
    let responseType: "tool_use" | "text" | "json" = "text";
    const toolsCalled: string[] = [];

    if (hasTools && !hasToolResults) {
      // agentLoop 第一轮：返回工具调用
      const toolBlocks = this.generateToolCalls(agentType, params);
      content = toolBlocks;
      stopReason = "tool_use";
      responseType = "tool_use";
      for (const block of toolBlocks) {
        if (block.type === "tool_use") {
          toolsCalled.push(block.name);
          report.recordToolCall({
            toolName: block.name,
            inputPreview: JSON.stringify(block.input).slice(0, 150),
            outputPreview: "(pending execution by handler)",
          });
        }
      }
    } else if (hasTools && hasToolResults) {
      // agentLoop 后续轮：结束循环
      content = [{ type: "text", text: this.getCompletionText(agentType) }];
      stopReason = "end_turn";
    } else {
      // 直接调用：返回 JSON 或文本
      const directResponse = this.generateDirectResponse(agentType, params);
      content = [{ type: "text", text: directResponse }];
      stopReason = "end_turn";
      responseType = directResponse.includes("{") ? "json" : "text";
    }

    // 记录到验证报告
    report.recordApiCall({
      timestamp: Date.now(),
      role: this.roleName,
      agentType,
      isAgentLoop: hasTools,
      isFollowUp: hasToolResults,
      systemPromptPreview: (params.system ?? "").slice(0, 200).replace(/\n/g, " "),
      userMessagePreview: this.extractUserMessage(params.messages).slice(0, 200),
      responseType,
      toolsCalled,
      durationMs: Date.now() - start,
    });

    return {
      id: `msg_mock_${Date.now()}`,
      type: "message",
      role: "assistant",
      content,
      model: params.model ?? "mock-model",
      stop_reason: stopReason,
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 50 },
    };
  }

  // ── 检测 agent 类型 ────────────────────────────────────

  private detectAgentType(system: string, messages: Array<{ role: string; content: unknown }>): string {
    const allText = system + " " + this.extractUserMessage(messages);

    // agentLoop 类型
    if (allText.includes("生成故事大纲") || allText.includes("生成${") && allText.includes("大纲")) return "planner-outline";
    if (allText.includes("生成人物设定")) return "planner-characters";
    if (allText.includes("生成人物关系")) return "planner-relationships";
    if (allText.includes("规划章节列表")) return "chapter-proposal";
    if (allText.includes("写作规则") && allText.includes("write_chapter")) return "writer";

    // 直接调用类型
    if (allText.includes("评审任务") && allText.includes("评分标准")) return "reviewer";
    if (allText.includes("是否覆盖了计划中的所有场景")) return "scene-check";
    if (allText.includes("审查") && allText.includes("连贯性")) return "coherence-audit";
    if (allText.includes("重建故事状态")) return "analysis";
    if (allText.includes("提取每个角色的语言特征")) return "voice-extract";
    if (allText.includes("制定结构化写作计划")) return "chapter-plan";

    // 压缩
    if (allText.includes("压缩") || allText.includes("summarize")) return "compress";

    return "unknown";
  }

  // ── agentLoop: 生成工具调用 ────────────────────────────

  private generateToolCalls(agentType: string, params: { system?: string }): MockContentBlock[] {
    switch (agentType) {
      case "planner-outline":
        return this.plannerToolCall("outline", MOCK_OUTLINE);

      case "planner-characters":
        return this.plannerToolCall("characters", MOCK_CHARACTERS);

      case "planner-relationships":
        return this.plannerToolCall("relationships", MOCK_RELATIONSHIPS);

      case "chapter-proposal":
        return [{
          type: "tool_use",
          id: nextToolId(),
          name: "propose_chapters",
          input: { chapters: MOCK_CHAPTERS },
        }];

      case "writer":
        return this.writerToolCalls(params.system ?? "");

      default:
        // 未识别类型：返回空文本结束
        return [{ type: "text", text: "[mock] 未识别的 agentLoop 类型" }];
    }
  }

  private plannerToolCall(type: string, content: string): MockContentBlock[] {
    return [{
      type: "tool_use",
      id: nextToolId(),
      name: "write_plan",
      input: { type, content },
    }];
  }

  private writerToolCalls(system: string): MockContentBlock[] {
    // 从 system prompt 提取章节编号和标题
    const numMatch = system.match(/chapter_number=(\d+)/);
    const chapterNum = numMatch ? parseInt(numMatch[1], 10) : 1;
    const titleMatch = system.match(/创作《[^》]+》的(.+?)。/) ?? system.match(/的(第\d+章.+?)[。\n]/);
    const chapterTitle = titleMatch ? titleMatch[1] : `第${chapterNum}章 测试`;

    // 从 system prompt 提取 todo task id
    const taskIdMatch = system.match(/update_todo 将任务 \[(\d+)\]/);
    const taskId = taskIdMatch ? parseInt(taskIdMatch[1], 10) : chapterNum;

    return [
      {
        type: "tool_use",
        id: nextToolId(),
        name: "write_chapter",
        input: {
          chapter_number: chapterNum,
          title: chapterTitle,
          content: generateMockChapterContent(chapterNum, chapterTitle),
        },
      },
      {
        type: "tool_use",
        id: nextToolId(),
        name: "write_story_so_far",
        input: {
          summary: `【故事摘要·截至第${chapterNum}章】\n\n[verify-mock] 这是自动生成的故事摘要，用于验证流水线完整性。第${chapterNum}章的主要事件已纳入。`,
        },
      },
      {
        type: "tool_use",
        id: nextToolId(),
        name: "write_handoff",
        input: {
          chapter_number: chapterNum,
          content: `[verify-mock] 第${chapterNum}章交接备忘：情绪紧张，对话未完，伏笔待推进。`,
        },
      },
      {
        type: "tool_use",
        id: nextToolId(),
        name: "update_foreshadowing",
        input: {
          updates: [{
            desc: `第${chapterNum}章测试伏笔`,
            chapter: `第${chapterNum}章`,
            status: "埋下",
            expected_resolution: `第${chapterNum + 2}章`,
          }],
        },
      },
      {
        type: "tool_use",
        id: nextToolId(),
        name: "update_todo",
        input: { id: taskId, status: "done" },
      },
    ];
  }

  // ── agentLoop: 结束文本 ────────────────────────────────

  private getCompletionText(agentType: string): string {
    if (agentType === "writer") return "本章完成";
    return "完成";
  }

  // ── 直接调用: 生成响应 ────────────────────────────────

  private generateDirectResponse(agentType: string, params: { messages: Array<{ role: string; content: unknown }> }): string {
    switch (agentType) {
      case "reviewer":
        return JSON.stringify({
          score: 4,
          feedback: "[verify-mock] 整体良好，语言有质感，情节推进自然。",
          weak_sections: ["[verify-mock] 中段节奏略缓"],
          weak_spots: [
            { excerpt: "[verify-mock] 她心想这一切都是命运", issue: "情绪直白", suggestion: "用行为细节替代内心独白直写" },
          ],
        });

      case "scene-check":
        return JSON.stringify({
          covered: ["场景1", "场景2"],
          missing: [],
        });

      case "coherence-audit":
        return "[verify-mock] 审查通过，暂未发现连贯性问题。";

      case "analysis":
        return JSON.stringify({
          story_so_far: "[verify-mock] 故事摘要：主角入京，宫廷暗流涌动。",
          chapters_with_metadata: MOCK_CHAPTERS,
          foreshadowing: [{
            desc: "密信内容",
            planted_at: "第1章",
            status: "已埋",
            expected_resolution: "第3章",
          }],
          breakpoint_analysis: "[verify-mock] 当前处于第一幕，下一章应承接入京后的宫廷布局。",
        });

      case "voice-extract":
        return "[verify-mock] 角色声音档案：\n- 沈清辞：语言克制、暗含锋芒\n- 萧衍：简洁有力、不怒自威";

      case "chapter-plan":
        return JSON.stringify({
          pov: "沈清辞",
          setting: "太子府 → 御花园",
          emotional_arc: { from: "压抑", to: "释然" },
          scenes: [
            { order: 1, description: "[verify-mock] 太子府密谈", emotion: "紧张", transition: "借故离席" },
            { order: 2, description: "[verify-mock] 御花园偶遇", emotion: "微妙" },
          ],
          foreshadowing: [
            { type: "plant", desc: "玉簪来历", detail: "预期第3章回收" },
          ],
          opening_hook: "[verify-mock] 以一封密信开篇",
          closing_hook: "[verify-mock] 萧衍意味深长的回眸",
          verify_checks: ["角色称谓一致", "时间线不矛盾", "字数不少于2000"],
        });

      case "compress":
        return "[verify-mock] 上下文已压缩为摘要。";

      default:
        return "[verify-mock] 默认响应文本。";
    }
  }

  // ── 工具方法 ────────────────────────────────────────────

  private containsToolResults(messages: Array<{ role: string; content: unknown }>): boolean {
    return messages.some((m) => {
      if (!Array.isArray(m.content)) return false;
      return (m.content as Array<{ type?: string }>).some((b) => b.type === "tool_result");
    });
  }

  private extractUserMessage(messages: Array<{ role: string; content: unknown }>): string {
    const last = messages[messages.length - 1];
    if (!last) return "";
    if (typeof last.content === "string") return last.content;
    if (Array.isArray(last.content)) {
      return (last.content as Array<{ type?: string; text?: string; content?: string }>)
        .map((b) => b.text ?? b.content ?? "")
        .join(" ");
    }
    return "";
  }
}

// ── Mock Anthropic 客户端工厂 ────────────────────────────

export interface MockAnthropicClient {
  messages: MockMessages;
  baseURL: string;
}

export function createMockClient(roleName: string): MockAnthropicClient {
  return {
    messages: new MockMessages(roleName),
    baseURL: "mock://verify",
  };
}

// ── Mock 数据常量 ────────────────────────────────────────

const MOCK_OUTLINE = `# 故事大纲

## 核心冲突
[verify-mock] 沈清辞被迫入宫和亲，与太子萧衍从对立到相知。

## 三幕结构
### 第一幕：入局（第1-2章）
沈清辞入京，初入宫廷的试探与防备。

### 第二幕：博弈（第3章）
宫廷斗争加剧，两人被迫合作。

### 第三幕：破局
真相揭露，做出抉择。`;

const MOCK_CHARACTERS = `# 人物设定

## 沈清辞
- 身份：北境将军之女
- 外貌：清冷，眉目如画
- 性格：表面温顺，内心刚烈
- 核心动机：保全家族
- 成长弧：从被动求存到主动掌握命运

## 萧衍
- 身份：当朝太子
- 外貌：俊朗，气度威严
- 性格：心思深沉，外冷内热
- 核心动机：稳固储位，肃清朝政
- 成长弧：从权谋工具到真心相待`;

const MOCK_RELATIONSHIPS = `# 人物关系

## 沈清辞 ↔ 萧衍
关系：政治联姻，从互相提防到暗生情愫
矛盾点：家族利益 vs 个人感情
情感走向：试探 → 合作 → 信任 → 心动

## 权力结构
沈家（北境军权） ←→ 太子府 ←→ 二皇子`;

const MOCK_CHAPTERS = [
  {
    title: "第1章 入京",
    target_words: 2000,
    mood: "压抑中带期待",
    required_scenes: ["沈清辞车队入京", "初见京城"],
    plot_hooks: ["密信伏笔"],
    transition_notes: "从北境回忆过渡到京城现实",
  },
  {
    title: "第2章 初见",
    target_words: 2000,
    mood: "紧张微妙",
    required_scenes: ["太子府相见", "暗中试探"],
    plot_hooks: ["玉簪伏笔"],
    transition_notes: "从入府仪式过渡到私下对话",
  },
  {
    title: "第3章 暗涌",
    target_words: 2000,
    mood: "紧张升级",
    required_scenes: ["宫宴风波", "密谈"],
    plot_hooks: ["二皇子势力线索"],
    transition_notes: "宫宴冲突后引出密谈",
  },
];

function generateMockChapterContent(chapterNum: number, title: string): string {
  const cleanTitle = title.replace(/^第\d+章\s*/, "");
  return `[verify-mock] 这是第${chapterNum}章《${cleanTitle}》的模拟正文内容。

此内容由验证系统自动生成，用于测试全流程链路的完整性。
实际运行时，此处将由 Writer Agent 根据 XML 章节计划生成真实小说内容。

${"正文内容填充。".repeat(100)}

本章结束。字数约 ${2000 + Math.floor(Math.random() * 500)} 字。`;
}
