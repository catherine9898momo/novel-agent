import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import path from "path";
import { FileMaterialStore } from "../src/materials/store.js";
import type {
  ChapterChainItem,
  CorrectedCharacterMaterial,
  CorrectedPlotThreadMaterial,
  MaterialSource,
  PlotThreadMaterial,
  RefinementReport,
} from "../src/materials/types.js";

const ROOT = path.resolve("materials/_test_store");

const source: MaterialSource = {
  id: "sample-book",
  title: "样例书",
  importedAt: "2026-06-28T00:00:00.000Z",
  wordCount: 1000,
  chapterCount: 2,
};

beforeEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
  await fs.mkdir(path.join(ROOT, source.id, "split"), { recursive: true });
});

afterEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
});

describe("FileMaterialStore", () => {
  it("reads split artifacts and writes corrected artifacts by element", async () => {
    const rawCharacter = {
      name: "长公主",
      aliases: [],
      roleGuess: "配角/压力源",
      importance: "supporting",
      mentionCount: 3,
      appearanceChapters: [1],
      desireGuess: "在压力中争取主动权",
      pressure: "外部评价和目标阻碍",
      firstSeenChapter: 1,
      evidence: ["长公主府灯火通明。"],
    };
    const rawThread: PlotThreadMaterial = {
      id: "mini-arc-1",
      title: "小故事：旧病复发",
      kind: "mini_arc",
      chapters: "第 1-2 章",
      chapterNumbers: [1, 2],
      involvedCharacters: ["长公主", "梅鹤庭"],
      summary: "长公主醒来后与梅鹤庭对峙。",
      background: "第 1 章建立病危与旧情背景。",
      keyEvents: ["醒来", "对峙"],
      outcome: "关系进入破裂状态。",
      promise: "期待误会揭开",
      conflict: "旧情与权力压力",
      payoff: "女主主动转身",
      readerPulls: ["期待关系变化"],
      childThreadIds: [],
    };
    const chapter: ChapterChainItem = {
      chapterNumber: 1,
      title: "觉",
      function: "建立开局困境",
      mainEvent: "宣明珠病醒后面对梅鹤庭。",
      conflict: "旧情、病危与权力身份叠加。",
      relationshipShift: "从期待转向疏离。",
      highlights: ["病醒对峙"],
      readerPulls: ["期待她如何反击"],
      hookOut: "她决定不再等待。",
      reusablePattern: "病弱醒来后用冷静态度完成关系翻转。",
    };

    await writeSplit("characters", [rawCharacter]);
    await writeSplit("plot_threads", [rawThread], "plot-threads.json");
    await writeSplit("chapter_chain", [chapter], "chapter-chain.json");

    const store = new FileMaterialStore(ROOT);
    const split = await store.readRawSplit(source.id);

    expect(split.characters[0].name).toBe("长公主");
    expect(split.plotThreads[0].id).toBe("mini-arc-1");
    expect(split.chapterChain[0].mainEvent).toContain("宣明珠");

    const correctedCharacters: CorrectedCharacterMaterial[] = [{
      name: "宣明珠",
      aliases: ["长公主", "大长公主"],
      role: "lead",
      function: "病弱但掌握主动权的核心人物",
      motivation: "摆脱旧情与权力困局",
      relationships: ["梅鹤庭：旧情破裂"],
      evidence: ["长公主府灯火通明。"],
      sourceCharacterNames: ["长公主"],
    }];
    const correctedPlotThreads: CorrectedPlotThreadMaterial[] = [{
      id: "mini-arc-1",
      title: "病醒后与旧情决裂",
      kind: "mini_arc",
      chapters: "第 1-2 章",
      chapterNumbers: [1, 2],
      involvedCharacters: ["宣明珠", "梅鹤庭"],
      background: "宣明珠病醒后处于长公主府和旧情压力之下。",
      summary: "宣明珠醒来后确认梅鹤庭的态度，转而主动抽离关系。",
      keyEvents: ["病醒", "对峙", "转身"],
      outcome: "她夺回关系主动权。",
      storyFunction: "用开局决裂建立女主爽点和追读期待。",
      readerPull: "读者想看梅鹤庭如何追悔，以及宣明珠如何反击。",
      evidence: ["宣明珠病醒后面对梅鹤庭。"],
      sourceThreadIds: ["mini-arc-1"],
    }];
    const report: RefinementReport = {
      sourceId: source.id,
      refinedAt: "2026-06-28T00:00:00.000Z",
      characterCount: 1,
      plotThreadCount: 1,
      rejectedCharacterCandidates: ["长公主"],
      notes: ["合并称谓别名"],
    };

    const paths = await store.writeCorrected(source.id, {
      characters: correctedCharacters,
      plotThreads: correctedPlotThreads,
      report,
    });
    const corrected = await store.readCorrected(source.id);

    expect(paths.characters).toBe(path.join(ROOT, source.id, "corrected", "characters.json"));
    expect(corrected.characters[0].aliases).toContain("长公主");
    expect(corrected.plotThreads[0].background).toContain("旧情压力");
    expect(corrected.report.rejectedCharacterCandidates).toContain("长公主");
  });
});

async function writeSplit(collection: string, items: unknown[], fileName = `${collection}.json`): Promise<void> {
  await fs.writeFile(
    path.join(ROOT, source.id, "split", fileName),
    JSON.stringify({ schemaVersion: 1, source, collection, count: items.length, items }, null, 2),
    "utf-8",
  );
}
