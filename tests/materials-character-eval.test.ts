import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import path from "path";
import {
  DEFAULT_QWEN_CHARACTER_EVAL_MODELS,
  evaluateCorrectedCharacters,
  runCharacterModelEvaluation,
} from "../src/materials/character-eval.js";
import type {
  ChapterChainItem,
  CharacterMaterial,
  CorrectedCharacterMaterial,
  MaterialSource,
  PlotThreadMaterial,
} from "../src/materials/types.js";

const ROOT = path.resolve("materials/_test_character_eval");
const source: MaterialSource = {
  id: "sample-book",
  title: "样例书",
  importedAt: "2026-06-28T00:00:00.000Z",
  wordCount: 1000,
  chapterCount: 1,
};

beforeEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
  await fs.mkdir(path.join(ROOT, source.id, "split"), { recursive: true });
});

afterEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
});

describe("character model evaluation", () => {
  it("scores alias merge hits, key characters, noise names, and field completeness", () => {
    const metrics = evaluateCorrectedCharacters([
      corrected("宣明珠", ["长公主", "大长公主", "殿下"]),
      corrected("梅鹤庭", ["梅大人", "梅长生", "长生"]),
      corrected("梅大人", []),
    ], { durationMs: 1200 });

    expect(metrics.characterCount).toBe(3);
    expect(metrics.aliasGroupHits).toBe(2);
    expect(metrics.keyCharacterHits).toBe(2);
    expect(metrics.noiseNameCount).toBe(1);
    expect(metrics.completeFieldRate).toBeGreaterThan(0.9);
    expect(metrics.coverageRate).toBe(1);
    expect(metrics.durationMs).toBe(1200);
  });

  it("runs qwen model evaluation into per-model folders and a summary file", async () => {
    await writeSplit("characters", [rawCharacter("长公主"), rawCharacter("梅鹤庭")]);
    await writeSplit("plot_threads", [plotThread()], "plot-threads.json");
    await writeSplit("chapter_chain", [chapter()], "chapter-chain.json");

    const summary = await runCharacterModelEvaluation({
      sourceId: source.id,
      rootDir: ROOT,
      models: ["qwen3:4b", "qwen3:8b"],
      now: () => "2026-06-28T00:00:00.000Z",
      createRefiner: (model) => ({
        refineCharacters: async () => ({
          characters: [corrected(model === "qwen3:4b" ? "长公主" : "宣明珠", ["大长公主"])],
          rejectedCandidates: [],
          notes: [`fake ${model}`],
        }),
        refinePlotThreads: async () => ({ plotThreads: [], notes: [] }),
      }),
    });

    expect(DEFAULT_QWEN_CHARACTER_EVAL_MODELS).toEqual(["qwen2.5:3b", "qwen2.5:7b"]);
    expect(summary.models.map((item) => item.model)).toEqual(["qwen3:4b", "qwen3:8b"]);
    expect(summary.models[1].metrics.keyCharacterHits).toBe(1);
    await expect(fs.stat(path.join(ROOT, source.id, "evals", "characters", "qwen3-8b", "characters.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(ROOT, source.id, "evals", "characters", "summary.json"))).resolves.toBeTruthy();
  });
});

function rawCharacter(name: string): CharacterMaterial {
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

function corrected(name: string, aliases: string[]): CorrectedCharacterMaterial {
  return {
    name,
    aliases,
    role: "lead",
    function: "病醒后夺回主动权的核心主角",
    motivation: "摆脱旧情消耗",
    relationships: ["梅鹤庭：旧情破裂"],
    evidence: ["宣明珠再不肯等。"],
    sourceCharacterNames: [name, ...aliases],
  };
}

function plotThread(): PlotThreadMaterial {
  return {
    id: "mini-arc-1",
    title: "小故事：觉",
    kind: "mini_arc",
    chapters: "第 1 章",
    chapterNumbers: [1],
    involvedCharacters: ["长公主", "梅鹤庭"],
    summary: "长公主醒来后与梅鹤庭对峙。",
    background: "第 1 章建立病醒背景。",
    keyEvents: ["醒来"],
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

async function writeSplit(collection: string, items: unknown[], fileName = `${collection}.json`): Promise<void> {
  await fs.writeFile(
    path.join(ROOT, source.id, "split", fileName),
    JSON.stringify({ schemaVersion: 1, source, collection, count: items.length, items }, null, 2),
    "utf-8",
  );
}
