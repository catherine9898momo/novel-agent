import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import path from "path";
import {
  buildStoryWindows,
  planStoryWindowsForSource,
} from "../src/materials/story-window-planner.js";
import type {
  ChapterChainItem,
  MaterialSource,
  PlotThreadMaterial,
} from "../src/materials/types.js";

const ROOT = path.resolve("materials/_test_story_windows");
const source: MaterialSource = {
  id: "sample-book",
  title: "样例书",
  importedAt: "2026-06-28T00:00:00.000Z",
  wordCount: 1000,
  chapterCount: 8,
};

beforeEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
  await fs.mkdir(path.join(ROOT, source.id, "split"), { recursive: true });
});

afterEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
});

describe("buildStoryWindows", () => {
  it("plans reviewable windows from plot threads, chapter chain, and fallback rules", () => {
    const result = buildStoryWindows({
      sourceId: source.id,
      chapterCount: 8,
      chapterChain: chapters(8),
      plotThreads: [
        thread("mini-arc-1", "旧爱被拒门外", "mini_arc", [1, 2]),
        thread("subplot-1", "查清寿宴旧事", "subplot", [3, 4, 5]),
        thread("phase-1", "入宫权力试探", "phase", [6, 7, 8, 9, 10, 11]),
      ],
      minSize: 2,
      maxSize: 5,
    });

    expect(result.windows.map((window) => window.chapterRange)).toEqual(expect.arrayContaining([
      "1-2",
      "3-5",
      "6-10",
      "11-11",
    ]));
    const opening = result.windows.find((window) => window.chapterRange === "1-2");
    expect(opening?.kind).toBe("opening_arc");
    expect(opening?.id).toBe("sample-book:window:1-2:opening_arc");
    expect(opening?.confidence.ruleScore).toBeGreaterThanOrEqual(0.7);
    expect(opening?.confidence.llmScore).toBeNull();
    expect(opening?.summary).toContain("旧爱被拒门外");

    const longTail = result.windows.find((window) => window.chapterRange === "11-11");
    expect(longTail?.qualityFlags).toContain("too_short");
    expect(result.summary.metrics.sourceCounts.plot_threads).toBeGreaterThanOrEqual(3);
    expect(result.summary.metrics.coverageRate).toBe(1);
    expect(result.summary.metrics.lowConfidenceWindowCount).toBeGreaterThanOrEqual(1);
  });

  it("falls back to fixed windows when plot threads are missing", () => {
    const result = buildStoryWindows({
      sourceId: source.id,
      chapterCount: 8,
      chapterChain: chapters(8),
      plotThreads: [],
      minSize: 2,
      maxSize: 5,
    });

    expect(result.windows.map((window) => window.chapterRange)).toEqual(["1-2", "3-5", "6-8"]);
    expect(result.windows[0].source).toBe("fallback");
    expect(result.summary.metrics.coverageRate).toBe(1);
  });
});

describe("planStoryWindowsForSource", () => {
  it("writes story windows, preview, quality report, and summary artifacts", async () => {
    await writeSplit("chapter_chain", chapters(5), "chapter-chain.json");
    await writeSplit("plot_threads", [
      thread("mini-arc-1", "病醒后旧情错位", "mini_arc", [1, 2]),
      thread("mini-arc-2", "寿宴余波发酵", "mini_arc", [3, 4, 5]),
    ], "plot-threads.json");
    await writeSplit("characters", [], "characters.json");

    const result = await planStoryWindowsForSource({
      sourceId: source.id,
      rootDir: ROOT,
      now: () => "2026-06-28T00:00:00.000Z",
    });

    expect(result.paths.storyWindows).toBe(path.join(ROOT, source.id, "windows", "story-windows.json"));
    await expect(fs.stat(result.paths.storyWindows)).resolves.toBeTruthy();
    await expect(fs.stat(result.paths.preview)).resolves.toBeTruthy();
    await expect(fs.stat(result.paths.qualityReport)).resolves.toBeTruthy();
    await expect(fs.stat(result.paths.summary)).resolves.toBeTruthy();

    const windows = JSON.parse(await fs.readFile(result.paths.storyWindows, "utf-8"));
    const preview = await fs.readFile(result.paths.preview, "utf-8");
    const qualityReport = await fs.readFile(result.paths.qualityReport, "utf-8");
    const summary = JSON.parse(await fs.readFile(result.paths.summary, "utf-8"));

    expect(windows[0].id).toBe("sample-book:window:1-2:opening_arc");
    expect(windows[0].startReason).toContain("第 1 章");
    expect(windows[0].endReason).toContain("第 2 章");
    expect(windows[0].confidence.llmModel).toBeNull();
    expect(preview).toContain("# 剧情窗口预览");
    expect(preview).toContain("第 1-2 章");
    expect(qualityReport).toContain("# 剧情窗口质量报告");
    expect(qualityReport).toContain("覆盖率");
    expect(summary.metrics.coverageRate).toBe(1);
  });
});

function chapters(count: number): ChapterChainItem[] {
  return Array.from({ length: count }, (_, index) => {
    const chapterNumber = index + 1;
    return {
      chapterNumber,
      title: `第 ${chapterNumber} 章`,
      function: chapterNumber <= 2 ? "建立开局旧情错位" : "推进小故事冲突",
      mainEvent: `第 ${chapterNumber} 章事件：人物围绕旧情和权力压力行动。`,
      conflict: `第 ${chapterNumber} 章冲突：旧情迟钝与女主清醒发生碰撞。`,
      relationshipShift: `第 ${chapterNumber} 章关系变化：主动权继续转移。`,
      highlights: [`第 ${chapterNumber} 章高光`],
      readerPulls: [`第 ${chapterNumber} 章追读点`],
      hookOut: `第 ${chapterNumber} 章结尾钩子。`,
      reusablePattern: "关系错位推动追悔期待。",
    };
  });
}

function thread(
  id: string,
  title: string,
  kind: PlotThreadMaterial["kind"],
  chapterNumbers: number[],
): PlotThreadMaterial {
  return {
    id,
    title,
    kind,
    chapters: `第 ${chapterNumbers[0]}-${chapterNumbers[chapterNumbers.length - 1]} 章`,
    chapterNumbers,
    involvedCharacters: ["宣明珠", "梅鹤庭"],
    summary: `${title}：宣明珠和梅鹤庭在这一段发生关系变化。`,
    background: "寿宴、病弱和旧情压力共同构成背景。",
    keyEvents: ["缺席寿宴", "被挡门外"],
    outcome: "关系主动权发生变化。",
    promise: "期待追悔与反击",
    conflict: "旧情迟钝与女主清醒",
    payoff: "女主停止讨好",
    readerPulls: ["期待梅鹤庭追悔"],
    childThreadIds: [],
  };
}

async function writeSplit(collection: string, items: unknown[], fileName = `${collection}.json`): Promise<void> {
  await fs.writeFile(
    path.join(ROOT, source.id, "split", fileName),
    JSON.stringify({ schemaVersion: 1, source, collection, count: items.length, items }, null, 2),
    "utf-8",
  );
}
