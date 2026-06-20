import { describe, it, expect, vi } from "vitest";
import { parseFanficIdeaText } from "../src/fanfic/idea-parser.js";
import type { ModelEndpoint } from "../src/models.js";

function endpointWithText(text: string): ModelEndpoint {
  return {
    model: "test-model",
    provider: "openai-compatible",
    client: {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text }],
        }),
      },
    } as unknown as ModelEndpoint["client"],
  };
}

const validJson = JSON.stringify({
  idea: {
    source: "示例恋歌",
    relationship: "沈知晚 x 陆承舟",
    timeline: "第二季结尾后",
    divergence: "陆承舟离开王都前一晚",
    tropes: ["未寄出的信", "雨夜共伞"],
    dislikes: ["突然告白", "恋爱脑"],
    rating: "清水",
    targetWordCount: 5000,
    ending: "开放式 HE",
    requiredScenes: ["藏在书页里的旧信", "长廊雨声"],
    summary: "两个人在离别前确认彼此没有说出口的心意。",
  },
  canon: {
    source: "示例恋歌",
    constraints: ["陆承舟习惯克制", "沈知晚不会逼问"],
    characterNotes: ["两人的情感推进依赖含蓄试探"],
    timelineNotes: ["陆承舟离开前只剩一夜"],
    risks: ["不要破坏陆承舟一贯自持"],
  },
});

describe("fanfic idea parser", () => {
  it("parses strict LLM JSON into a structured story card and canon card", async () => {
    const endpoint = endpointWithText(validJson);

    const result = await parseFanficIdeaText("想写雨夜旧信", { endpoint });

    expect(result.idea.source).toBe("示例恋歌");
    expect(result.idea.relationship).toBe("沈知晚 x 陆承舟");
    expect(result.idea.targetWordCount).toBe(5000);
    expect(result.idea.requiredScenes).toContain("藏在书页里的旧信");
    expect(result.idea.rawIdea).toBe("想写雨夜旧信");
    expect(result.canon.constraints).toContain("陆承舟习惯克制");
    expect(result.canon.rawIdea).toBe("想写雨夜旧信");
  });

  it("rejects malformed or incomplete LLM output", async () => {
    const endpoint = endpointWithText(JSON.stringify({ idea: { source: "示例恋歌" }, canon: {} }));

    await expect(parseFanficIdeaText("缺字段", { endpoint }))
      .rejects.toThrow(/Invalid fanfic idea parse result/i);
  });
});
