import { describe, it, expect } from "vitest";
import { estimateTokens, microCompress } from "../src/context-compact.js";
import type { Message } from "../src/agent-loop.js";

// ── estimateTokens ──────────────────────────────────────────

describe("estimateTokens", () => {
  it("纯英文：4 chars ≈ 1 token", () => {
    const msgs: Message[] = [{ role: "user", content: "abcd" }]; // 4 chars → 1 token
    expect(estimateTokens(msgs)).toBe(1);
  });

  it("纯中文：1 字 ≈ 1.5 tokens", () => {
    const msgs: Message[] = [{ role: "user", content: "你好" }]; // 2 CJK → 3 tokens
    expect(estimateTokens(msgs)).toBe(3);
  });

  it("中英混合", () => {
    // "你好world" → 2 CJK (3) + 5 other (1.25) = 4.25 → ceil → 5
    const msgs: Message[] = [{ role: "user", content: "你好world" }];
    expect(estimateTokens(msgs)).toBe(5);
  });

  it("空消息返回 0", () => {
    expect(estimateTokens([])).toBe(0);
  });

  it("多条消息累加", () => {
    const msgs: Message[] = [
      { role: "user", content: "你好" },       // 3
      { role: "assistant", content: "世界" },   // 3
    ];
    expect(estimateTokens(msgs)).toBe(6);
  });

  it("content 为数组（含 text block）", () => {
    const msgs: Message[] = [{
      role: "user",
      content: [{ type: "text" as const, text: "你好" }],
    }];
    expect(estimateTokens(msgs)).toBe(3);
  });

  it("content 为数组（含 tool_result block）", () => {
    const msgs: Message[] = [{
      role: "user",
      content: [{
        type: "tool_result" as const,
        tool_use_id: "t1",
        content: "abcdefgh", // 8 chars → 2 tokens
      }],
    }];
    expect(estimateTokens(msgs)).toBe(2);
  });
});

// ── microCompress ───────────────────────────────────────────

describe("microCompress", () => {
  function makeToolResultMsg(content: string): Message {
    return {
      role: "user",
      content: [{
        type: "tool_result" as const,
        tool_use_id: "t-" + Math.random().toString(36).slice(2, 6),
        content,
      }],
    };
  }

  it("保留最近 keepLast 条不截断", () => {
    const longContent = "x".repeat(200);
    const msgs: Message[] = [
      makeToolResultMsg(longContent),
      makeToolResultMsg(longContent),
      makeToolResultMsg(longContent),
    ];

    microCompress(msgs, 3);

    // 全部保留（只有 3 条，keepLast=3）
    for (const msg of msgs) {
      const block = (msg.content as any[])[0];
      expect(block.content.length).toBe(200);
    }
  });

  it("截断超出 keepLast 的旧消息", () => {
    const longContent = "x".repeat(200);
    const msgs: Message[] = [
      makeToolResultMsg(longContent), // 旧 → 应被截断
      makeToolResultMsg(longContent), // 保留
      makeToolResultMsg(longContent), // 保留
    ];

    microCompress(msgs, 2);

    const oldBlock = (msgs[0].content as any[])[0];
    expect(oldBlock.content.length).toBeLessThan(200);
    expect(oldBlock.content).toContain("…[已截断]");

    // 最近 2 条不变
    const recent1 = (msgs[1].content as any[])[0];
    const recent2 = (msgs[2].content as any[])[0];
    expect(recent1.content.length).toBe(200);
    expect(recent2.content.length).toBe(200);
  });

  it("短内容不被截断（< 100 字符）", () => {
    const shortContent = "short";
    const msgs: Message[] = [
      makeToolResultMsg(shortContent), // 旧但短
      makeToolResultMsg("x".repeat(200)),
      makeToolResultMsg("x".repeat(200)),
    ];

    microCompress(msgs, 2);

    const oldBlock = (msgs[0].content as any[])[0];
    expect(oldBlock.content).toBe("short");
  });

  it("非 tool_result 消息不受影响", () => {
    const msgs: Message[] = [
      { role: "user", content: "普通消息，很长".repeat(50) },
      makeToolResultMsg("x".repeat(200)),
      makeToolResultMsg("x".repeat(200)),
    ];

    microCompress(msgs, 1);

    // 普通消息不变
    expect((msgs[0].content as string).length).toBeGreaterThan(100);
  });
});
