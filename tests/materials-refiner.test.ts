import { describe, expect, it } from "vitest";
import { buildCharacterRefinementPrompt, buildPlotThreadRefinementPrompt } from "../src/materials/refiner-prompts.js";
import { refineMaterials } from "../src/materials/refiner.js";
import type {
  ChapterChainItem,
  CharacterMaterial,
  CorrectedCharacterMaterial,
  CorrectedPlotThreadMaterial,
  PlotThreadMaterial,
} from "../src/materials/types.js";

const rawCharacters: CharacterMaterial[] = [
  character("长公主", ["长公主醒来。"], 1),
  character("大长公主", ["大长公主只把旧信放下。"], 1),
  character("宣明珠", ["宣明珠再不肯等。"], 1),
  character("梅大人", ["旁人都称梅大人。"], 2),
  character("梅鹤庭", ["梅鹤庭站在门外。"], 2),
];

const rawPlotThreads: PlotThreadMaterial[] = [{
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
}];

const chapterChain: ChapterChainItem[] = [{
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
}];

describe("materials refiner", () => {
  it("refines only characters and plot threads through an injectable refiner", async () => {
    const correctedCharacters: CorrectedCharacterMaterial[] = [{
      name: "宣明珠",
      aliases: ["长公主", "大长公主"],
      role: "lead",
      function: "病醒后夺回主动权的核心主角",
      motivation: "摆脱旧情消耗并守住身份尊严",
      relationships: ["梅鹤庭：旧情破裂"],
      evidence: ["宣明珠再不肯等。"],
      sourceCharacterNames: ["长公主", "大长公主", "宣明珠"],
    }, {
      name: "梅鹤庭",
      aliases: ["梅大人"],
      role: "love_interest",
      function: "制造追悔张力的关键关系对象",
      motivation: "维持旧关系和官场体面",
      relationships: ["宣明珠：错过后的追悔对象"],
      evidence: ["梅鹤庭站在门外。"],
      sourceCharacterNames: ["梅大人", "梅鹤庭"],
    }];
    const correctedPlotThreads: CorrectedPlotThreadMaterial[] = [{
      id: "mini-arc-1",
      title: "病醒后与旧情决裂",
      kind: "mini_arc",
      chapters: "第 1-2 章",
      chapterNumbers: [1, 2],
      involvedCharacters: ["宣明珠", "梅鹤庭"],
      background: "宣明珠在病醒、长公主身份与旧情拉扯下被迫重新判断关系。",
      summary: "宣明珠醒来后看清梅鹤庭的退缩，借对峙完成从等待到抽离的转变。",
      keyEvents: ["病醒", "确认旧人态度", "主动抽离"],
      outcome: "女主夺回关系主动权，并埋下男主追悔线。",
      storyFunction: "开局用决裂制造爽点和后续追读欠账。",
      readerPull: "读者想看梅鹤庭如何后悔，以及宣明珠如何反击。",
      evidence: ["宣明珠醒来后面对梅鹤庭与府中压力。"],
      sourceThreadIds: ["mini-arc-1"],
    }];
    const writes: unknown[] = [];
    const store = {
      readRawSplit: async () => ({ characters: rawCharacters, plotThreads: rawPlotThreads, chapterChain }),
      writeCorrected: async (_sourceId: string, payload: unknown) => {
        writes.push(payload);
        return { characters: "", plotThreads: "", report: "" };
      },
    };
    const refiner = {
      refineCharacters: async (input: { characters: CharacterMaterial[] }) => {
        expect(input.characters).toHaveLength(5);
        return { characters: correctedCharacters, rejectedCandidates: ["长公主", "大长公主", "梅大人"], notes: ["合并别名"] };
      },
      refinePlotThreads: async (input: { characters: CorrectedCharacterMaterial[]; plotThreads: PlotThreadMaterial[] }) => {
        expect(input.characters[0].name).toBe("宣明珠");
        expect(input.plotThreads[0].summary).toContain("梅鹤庭");
        return { plotThreads: correctedPlotThreads, notes: ["补全背景和读者吸引点"] };
      },
    };

    const result = await refineMaterials({
      sourceId: "chang-gong-zhu",
      store,
      refiner,
      now: () => "2026-06-28T00:00:00.000Z",
    });

    expect(result.characters.map((item) => item.name)).toEqual(["宣明珠", "梅鹤庭"]);
    expect(result.report.rejectedCharacterCandidates).toEqual(["长公主", "大长公主", "梅大人"]);
    expect(result.report.characterCount).toBe(2);
    expect(writes).toHaveLength(1);
  });

  it("builds strict prompts for the two LLM correction targets", () => {
    const characterPrompt = buildCharacterRefinementPrompt({ characters: rawCharacters, plotThreads: rawPlotThreads, chapterChain });
    const plotPrompt = buildPlotThreadRefinementPrompt({
      plotThreads: rawPlotThreads,
      characters: [{
        name: "宣明珠",
        aliases: ["长公主"],
        role: "lead",
        function: "核心主角",
        motivation: "夺回主动权",
        relationships: [],
        evidence: [],
        sourceCharacterNames: ["长公主", "宣明珠"],
      }],
      chapterChain,
    });

    expect(characterPrompt.system).toContain("strict JSON");
    expect(characterPrompt.user).toContain("sourceCharacterNames");
    expect(characterPrompt.user).toContain("rejectedCandidates");
    expect(characterPrompt.user).toContain("长公主");
    expect(plotPrompt.user).toContain("background");
    expect(plotPrompt.user).toContain("storyFunction");
    expect(plotPrompt.user).toContain("readerPull");
  });
});

function character(name: string, evidence: string[], firstSeenChapter: number): CharacterMaterial {
  return {
    name,
    aliases: [],
    roleGuess: "配角/压力源",
    importance: "supporting",
    mentionCount: 1,
    appearanceChapters: [firstSeenChapter],
    desireGuess: "在压力中争取主动权",
    pressure: "外部评价和目标阻碍",
    firstSeenChapter,
    evidence,
  };
}
