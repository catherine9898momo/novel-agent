/**
 * context-profiler.test.ts - 上下文预检单测
 */

import { describe, expect, it } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { estimateInputTokens, profileNovelContext } from "../src/context-profiler.js";

describe("estimateInputTokens", () => {
  it("中文字符按接近 1 token 估算", () => {
    expect(estimateInputTokens("烟雨长安")).toBe(4);
  });

  it("英文按约 4 chars/token 估算", () => {
    expect(estimateInputTokens("abcdefgh")).toBe(2);
  });
});

describe("profileNovelContext", () => {
  it("按 review/analyze/audit 三类任务拆分上下文", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "novel-context-"));
    await fs.writeFile(path.join(dir, "_outline.md"), "大纲".repeat(10), "utf-8");
    await fs.writeFile(path.join(dir, "_characters.md"), "人物".repeat(10), "utf-8");
    await fs.writeFile(path.join(dir, "_relationships.md"), "关系".repeat(10), "utf-8");
    await fs.writeFile(path.join(dir, "_chapters.json"), JSON.stringify([{ title: "第一章" }]), "utf-8");
    await fs.writeFile(path.join(dir, "_story_so_far.md"), "摘要".repeat(10), "utf-8");
    await fs.writeFile(path.join(dir, "001-入京.md"), "第一章正文".repeat(20), "utf-8");
    await fs.writeFile(path.join(dir, "002-初见.md"), "第二章正文".repeat(20), "utf-8");

    const profile = await profileNovelContext("测试", dir, "风格指南");

    expect(profile.chapterCount).toBe(2);
    expect(profile.tasks.map((task) => task.task)).toEqual(["review", "analyze", "audit"]);

    const review = profile.tasks.find((task) => task.task === "review")!;
    const analyze = profile.tasks.find((task) => task.task === "analyze")!;
    const audit = profile.tasks.find((task) => task.task === "audit")!;

    expect(review.files.some((file) => file.file === "002-初见.md")).toBe(true);
    expect(review.files.some((file) => file.file === "001-入京.md")).toBe(false);
    expect(analyze.files.filter((file) => file.kind === "chapter")).toHaveLength(2);
    expect(audit.files.some((file) => file.file === "_outline.md")).toBe(false);
  });
});
