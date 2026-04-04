/**
 * context-compact.ts - 上下文压缩 (s06 概念)
 *
 * 三层压缩策略：
 *   Layer 1: microCompress - 截断旧的工具结果
 *   Layer 2: autoCompress  - 超过阈值时用 LLM 总结历史
 *   Layer 3: compact 工具  - LLM 主动调用（在 tools.ts 中定义）
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Message } from "./agent-loop.js";

/**
 * 估算 messages 的 token 数量
 * 中文字符：1 字 ≈ 1.5 tokens；其余字符：4 chars ≈ 1 token
 */
export function estimateTokens(messages: Message[]): number {
  let total = 0;
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      total += estimateStringTokens(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if ("text" in block && typeof block.text === "string") {
          total += estimateStringTokens(block.text);
        } else if ("content" in block && typeof block.content === "string") {
          total += estimateStringTokens(block.content);
        }
      }
    }
  }
  return Math.ceil(total);
}

function estimateStringTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    // CJK Unified Ideographs + common CJK punctuation ranges
    if (ch.charCodeAt(0) >= 0x4e00 && ch.charCodeAt(0) <= 0x9fff) {
      cjk++;
    } else {
      other++;
    }
  }
  return cjk * 1.5 + other / 4;
}

/**
 * Layer 1: 微压缩
 * 从旧到新遍历，超过 keepLast 的 tool_result 消息截断 content 到 100 字符
 */
export function microCompress(messages: Message[], keepLast = 3): void {
  // 找出所有包含 tool_result 的 user 消息的索引
  const toolResultIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "user" && Array.isArray(msg.content)) {
      const hasToolResult = msg.content.some((b) => "type" in b && b.type === "tool_result");
      if (hasToolResult) toolResultIndices.push(i);
    }
  }

  // 只截断旧的（保留最近 keepLast 条不动）
  const toTruncate = toolResultIndices.slice(0, -keepLast);
  for (const idx of toTruncate) {
    const msg = messages[idx];
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if ("type" in block && block.type === "tool_result" && typeof block.content === "string") {
        if (block.content.length > 100) {
          (block as { content: string }).content = block.content.slice(0, 100) + "…[已截断]";
        }
      }
    }
  }
}

/**
 * Layer 2: 自动压缩
 * 超过 token 阈值时，用 LLM 总结历史，原地替换 messages
 * @returns true 表示发生了压缩，false 表示未触发
 */
export async function autoCompress(
  client: Anthropic,
  model: string,
  messages: Message[],
  threshold = 80_000,
): Promise<boolean> {
  if (estimateTokens(messages) < threshold) return false;

  // 保留最近 4 条消息（2 轮对话），只压缩更早的历史
  const keepRecent = 4;
  const toCompress = messages.slice(0, Math.max(0, messages.length - keepRecent));
  const recentMessages = messages.slice(Math.max(0, messages.length - keepRecent));

  if (toCompress.length === 0) return false; // 没有可压缩的内容

  // 序列化需要压缩的部分为可读文本
  const serialized = toCompress
    .map((m) => {
      const role = m.role.toUpperCase();
      if (typeof m.content === "string") return `[${role}]: ${m.content}`;
      if (Array.isArray(m.content)) {
        const parts = m.content.map((b) => {
          if ("text" in b) return b.text;
          if ("content" in b && typeof b.content === "string") return `[工具结果]: ${b.content}`;
          return "[工具调用]";
        });
        return `[${role}]: ${parts.join(" ")}`;
      }
      return "";
    })
    .join("\n\n");

  const summaryResponse = await client.messages.create({
    model,
    system: "你是一个对话历史摘要助手。请将以下对话历史压缩为简洁的摘要，保留关键信息：已完成的任务、写好的章节内容要点、重要决策、尚未解决的伏笔。摘要用中文，结构清晰。",
    messages: [{ role: "user", content: `请总结以下对话历史：\n\n${serialized}` }],
    max_tokens: 2000,
  });

  const summary =
    summaryResponse.content[0].type === "text" ? summaryResponse.content[0].text : "（摘要生成失败）";

  // 原地替换 messages：摘要 + 保留的最近消息
  messages.length = 0;
  messages.push(
    { role: "user", content: `[对话历史摘要]\n${summary}` },
    { role: "assistant", content: "已了解之前的进度，继续完成剩余任务。" },
    ...recentMessages,
  );

  return true;
}
