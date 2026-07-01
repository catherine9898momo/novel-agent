import { describe, expect, it, vi } from "vitest";
import { createOllamaEndpoint, OllamaCharacterMaterialRefiner } from "../src/materials/ollama-refiner.js";
import type { ModelEndpoint } from "../src/models.js";
import type { ChapterChainItem, CharacterMaterial, PlotThreadMaterial } from "../src/materials/types.js";

describe("OllamaCharacterMaterialRefiner", () => {
  it("sends character refinement to an OpenAI-compatible local endpoint", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{
        type: "text",
        text: JSON.stringify({
          characters: [{
            name: "宣明珠",
            aliases: ["长公主", "大长公主"],
            role: "lead",
            function: "病醒后夺回主动权的核心主角",
            motivation: "摆脱旧情消耗",
            relationships: ["梅鹤庭：旧情破裂"],
            evidence: ["宣明珠再不肯等。"],
            sourceCharacterNames: ["长公主", "大长公主", "宣明珠"],
          }],
          rejectedCandidates: ["长公主", "大长公主"],
          notes: ["qwen merged title aliases"],
        }),
      }],
    });
    const endpoint = {
      model: "qwen3:8b",
      provider: "openai-compatible",
      client: { messages: { create } },
    } as unknown as ModelEndpoint;
    const refiner = new OllamaCharacterMaterialRefiner({ endpoint, model: "qwen3:8b" });

    const output = await refiner.refineCharacters({
      characters: [character("长公主"), character("大长公主"), character("宣明珠")],
      plotThreads: [plotThread()],
      chapterChain: [chapter()],
    });

    expect(output.characters[0].name).toBe("宣明珠");
    expect(output.rejectedCandidates).toEqual(["长公主", "大长公主"]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({
      model: "qwen3:8b",
      response_format: { type: "json_object" },
    });
  });

  it("builds an Ollama endpoint with qwen3:8b defaults", () => {
    const endpoint = createOllamaEndpoint();

    expect(endpoint.model).toBe("qwen3:8b");
    expect(endpoint.provider).toBe("openai-compatible");
    expect(endpoint.client.messages.create).toBeTypeOf("function");
  });
});

function character(name: string): CharacterMaterial {
  return {
    name,
    aliases: [],
    roleGuess: "配角/压力源",
    importance: "supporting",
    mentionCount: 1,
    appearanceChapters: [1],
    desireGuess: "在压力中争取主动权",
    pressure: "外部评价和目标阻碍",
    firstSeenChapter: 1,
    evidence: [`${name}出场。`],
  };
}

function plotThread(): PlotThreadMaterial {
  return {
    id: "mini-arc-1",
    title: "小故事：觉",
    kind: "mini_arc",
    chapters: "第 1-2 章",
    chapterNumbers: [1, 2],
    involvedCharacters: ["长公主", "梅鹤庭"],
    summary: "长公主醒来后与梅鹤庭对峙。",
    background: "第 1 章建立病醒背景。",
    keyEvents: ["醒来", "对峙"],
    outcome: "关系破裂。",
    promise: "期待旧情反转",
    conflict: "病危和旧情",
    payoff: "女主转身",
    readerPulls: ["期待后悔"],
    childThreadIds: [],
  };
}

function chapter(): ChapterChainItem {
  return {
    chapterNumber: 1,
    title: "觉",
    function: "开局",
    mainEvent: "宣明珠醒来后面对梅鹤庭与府中压力。",
    conflict: "病危、身份与旧情压在同一场戏里。",
    relationshipShift: "从等待走向抽离。",
    highlights: ["冷静对峙"],
    readerPulls: ["期待追悔"],
    hookOut: "她不再等他。",
    reusablePattern: "用称谓和身体危机叠加身份压力。",
  };
}
