import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";

// 动态导入以避免 models.ts 中的 dotenv 副作用
let detectFiles: typeof import("../src/orchestrator.js").detectFiles;
let loadChapters: typeof import("../src/novel-agent.js").loadChapters;

beforeEach(async () => {
  const orchestrator = await import("../src/orchestrator.js");
  const mod = await import("../src/novel-agent.js");
  detectFiles = orchestrator.detectFiles;
  loadChapters = mod.loadChapters;
});

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "novel-state-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── detectFiles ─────────────────────────────────────────────

describe("detectFiles", () => {
  it("空目录：所有状态为 false", async () => {
    const state = await detectFiles(tmpDir);
    expect(state.hasOutline).toBe(false);
    expect(state.hasCharacters).toBe(false);
    expect(state.hasRelationships).toBe(false);
    expect(state.hasChapters).toBe(false);
    expect(state.hasStorySoFar).toBe(false);
    expect(state.chaptersHaveMetadata).toBe(false);
    expect(state.existingChapterNums).toEqual([]);
  });

  it("检测规划文件存在", async () => {
    await fs.writeFile(path.join(tmpDir, "_outline.md"), "大纲内容");
    await fs.writeFile(path.join(tmpDir, "_characters.md"), "人物设定");

    const state = await detectFiles(tmpDir);
    expect(state.hasOutline).toBe(true);
    expect(state.hasCharacters).toBe(true);
    expect(state.hasRelationships).toBe(false);
  });

  it("检测已有章节编号", async () => {
    await fs.writeFile(path.join(tmpDir, "001-第一章.md"), "内容");
    await fs.writeFile(path.join(tmpDir, "003-第三章.md"), "内容");
    await fs.writeFile(path.join(tmpDir, "_outline.md"), "非章节文件");

    const state = await detectFiles(tmpDir);
    expect(state.existingChapterNums).toEqual([1, 3]);
  });

  it("检测章节元数据（对象格式 vs 字符串格式）", async () => {
    // 字符串格式 → chaptersHaveMetadata = false
    await fs.writeFile(
      path.join(tmpDir, "_chapters.json"),
      JSON.stringify(["第一章", "第二章"]),
    );
    let state = await detectFiles(tmpDir);
    expect(state.hasChapters).toBe(true);
    expect(state.chaptersHaveMetadata).toBe(false);

    // 对象格式 → chaptersHaveMetadata = true
    await fs.writeFile(
      path.join(tmpDir, "_chapters.json"),
      JSON.stringify([{ title: "第一章", mood: "紧张" }]),
    );
    state = await detectFiles(tmpDir);
    expect(state.chaptersHaveMetadata).toBe(true);
  });

  it("不存在的目录不报错，返回空状态", async () => {
    const state = await detectFiles("/tmp/nonexistent-novel-dir-" + Date.now());
    expect(state.hasOutline).toBe(false);
    expect(state.existingChapterNums).toEqual([]);
  });
});

// ── loadChapters ────────────────────────────────────────────

describe("loadChapters", () => {
  it("文件不存在返回 null", async () => {
    const result = await loadChapters(tmpDir);
    expect(result).toBeNull();
  });

  it("纯字符串数组 → 转为 ChapterMeta 对象", async () => {
    await fs.writeFile(
      path.join(tmpDir, "_chapters.json"),
      JSON.stringify(["第一章：初遇", "第二章：误解"]),
    );
    const chapters = await loadChapters(tmpDir);
    expect(chapters).toHaveLength(2);
    expect(chapters![0]).toEqual({ title: "第一章：初遇" });
    expect(chapters![1]).toEqual({ title: "第二章：误解" });
  });

  it("对象数组 → 保留完整元数据", async () => {
    const data = [
      { title: "第一章", mood: "悬疑", target_words: 3000 },
      { title: "第二章", mood: "温馨", plot_hooks: ["伏笔A"] },
    ];
    await fs.writeFile(path.join(tmpDir, "_chapters.json"), JSON.stringify(data));

    const chapters = await loadChapters(tmpDir);
    expect(chapters).toHaveLength(2);
    expect(chapters![0].mood).toBe("悬疑");
    expect(chapters![0].target_words).toBe(3000);
    expect(chapters![1].plot_hooks).toEqual(["伏笔A"]);
  });

  it("混合数组（字符串 + 对象）→ 统一转为对象", async () => {
    const data = [
      "第一章：序幕",
      { title: "第二章", mood: "紧张" },
    ];
    await fs.writeFile(path.join(tmpDir, "_chapters.json"), JSON.stringify(data));

    const chapters = await loadChapters(tmpDir);
    expect(chapters![0]).toEqual({ title: "第一章：序幕" });
    expect(chapters![1].mood).toBe("紧张");
  });
});
