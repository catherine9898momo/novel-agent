import { describe, expect, it } from "vitest";
import { composeMaterialBrief } from "../src/materials/brief-composer.js";
import type { CorrectedCharacterMaterial, CorrectedPlotThreadMaterial } from "../src/materials/types.js";

describe("composeMaterialBrief", () => {
  it("turns corrected materials into a planning-only brief", () => {
    const characters: CorrectedCharacterMaterial[] = [{
      name: "宣明珠",
      aliases: ["长公主"],
      role: "lead",
      function: "病醒后夺回主动权的核心主角",
      motivation: "摆脱旧情消耗并守住身份尊严",
      relationships: ["梅鹤庭：旧情破裂"],
      evidence: ["宣明珠再不肯等。"],
      sourceCharacterNames: ["长公主", "宣明珠"],
    }];
    const plotThreads: CorrectedPlotThreadMaterial[] = [{
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

    const brief = composeMaterialBrief({
      sourceId: "chang-gong-zhu",
      idea: "女主重生后不再倒贴旧爱",
      characters,
      plotThreads,
      now: () => "2026-06-28T00:00:00.000Z",
    });

    expect(brief.planningOnly).toBe(true);
    expect(brief.characterSeeds[0]).toMatchObject({
      name: "宣明珠",
      function: "病醒后夺回主动权的核心主角",
    });
    expect(brief.relationshipDynamics).toContain("梅鹤庭：旧情破裂");
    expect(brief.plotStructures[0]).toContain("开局用决裂制造爽点");
    expect(brief.chapterHooks[0]).toContain("读者想看");
    expect(brief.safetyNotes.join("\n")).toContain("planning");
  });
});
