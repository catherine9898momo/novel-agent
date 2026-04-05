/**
 * tools.test.ts - 工具执行逻辑单测
 *
 * 验证每个工具 handler 的核心行为：
 *   - write_chapter: 写入、幂等保护、草稿→正式原子重命名
 *   - read_chapter: 读取已有/不存在章节
 *   - write_plan / read_plan: 规划文件读写
 *   - propose_chapters: 章节列表保存 + 回调
 *   - update_foreshadowing: 伏笔新增/更新
 *   - list_chapters: 列出已完成章节
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import { makeToolHandlers } from "../src/tools.js";

const TEST_NOVEL = "_test_tools_novel";
const NOVELS_DIR = path.resolve("novels");
const TEST_DIR = path.join(NOVELS_DIR, TEST_NOVEL);

beforeEach(async () => {
  await fs.mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

describe("write_chapter", () => {
  it("写入章节文件，格式正确", async () => {
    const handlers = makeToolHandlers(TEST_NOVEL);
    const result = await handlers.write_chapter({
      chapter_number: 1,
      title: "初遇",
      content: "正文内容",
    });
    expect(result).toContain("已保存");

    const files = await fs.readdir(TEST_DIR);
    const chFile = files.find(f => f.startsWith("001"));
    expect(chFile).toBe("001-初遇.md");

    const content = await fs.readFile(path.join(TEST_DIR, chFile!), "utf-8");
    expect(content).toContain("# 第1章 初遇");
    expect(content).toContain("正文内容");
  });

  it("幂等保护：已有章节不覆盖", async () => {
    const handlers = makeToolHandlers(TEST_NOVEL);
    await handlers.write_chapter({ chapter_number: 1, title: "初遇", content: "v1" });
    const result = await handlers.write_chapter({ chapter_number: 1, title: "初遇改", content: "v2" });
    expect(result).toContain("已存在");
    expect(result).toContain("跳过");
  });

  it("标题自动去除'第X章'前缀", async () => {
    const handlers = makeToolHandlers(TEST_NOVEL);
    await handlers.write_chapter({ chapter_number: 2, title: "第2章 重逢", content: "内容" });
    const files = await fs.readdir(TEST_DIR);
    const chFile = files.find(f => f.startsWith("002"));
    expect(chFile).toBe("002-重逢.md");
  });
});

describe("read_chapter", () => {
  it("读取已有章节", async () => {
    const handlers = makeToolHandlers(TEST_NOVEL);
    await handlers.write_chapter({ chapter_number: 1, title: "初遇", content: "正文" });
    const result = await handlers.read_chapter({ chapter_number: 1 });
    expect(result).toContain("正文");
  });

  it("读取不存在的章节", async () => {
    const handlers = makeToolHandlers(TEST_NOVEL);
    const result = await handlers.read_chapter({ chapter_number: 99 });
    expect(result).toContain("尚未写作");
  });
});

describe("write_plan / read_plan", () => {
  it("写入并读取规划文件", async () => {
    const handlers = makeToolHandlers(TEST_NOVEL);
    const writeResult = await handlers.write_plan({ type: "outline", content: "# 大纲\n测试" });
    expect(writeResult).toContain("已保存");

    const readResult = await handlers.read_plan({ type: "outline" });
    expect(readResult).toBe("# 大纲\n测试");
  });

  it("读取不存在的规划文件", async () => {
    const handlers = makeToolHandlers(TEST_NOVEL);
    const result = await handlers.read_plan({ type: "characters" });
    expect(result).toContain("尚未生成");
  });
});

describe("propose_chapters", () => {
  it("保存章节列表为 JSON", async () => {
    const handlers = makeToolHandlers(TEST_NOVEL);
    const result = await handlers.propose_chapters({
      chapters: [
        { title: "第一章 初遇", target_words: 3000, mood: "紧张" },
        { title: "第二章 重逢", target_words: 3000, mood: "温馨" },
      ],
    });
    expect(result).toContain("2 章");

    const raw = await fs.readFile(path.join(TEST_DIR, "_chapters.json"), "utf-8");
    const chapters = JSON.parse(raw);
    expect(chapters).toHaveLength(2);
    expect(chapters[0].title).toBe("第一章 初遇");
  });

  it("支持简单字符串数组", async () => {
    const handlers = makeToolHandlers(TEST_NOVEL);
    await handlers.propose_chapters({ chapters: ["初遇", "重逢"] });

    const raw = await fs.readFile(path.join(TEST_DIR, "_chapters.json"), "utf-8");
    const chapters = JSON.parse(raw);
    expect(chapters[0]).toEqual({ title: "初遇" });
  });

  it("触发 onChaptersProposed 回调", async () => {
    const proposed: string[] = [];
    const handlers = makeToolHandlers(TEST_NOVEL, undefined, undefined, undefined, (ch) => { proposed.push(...ch); });
    await handlers.propose_chapters({ chapters: ["A", "B", "C"] });
    expect(proposed).toEqual(["A", "B", "C"]);
  });
});

describe("list_chapters", () => {
  it("无章节时返回提示", async () => {
    const handlers = makeToolHandlers(TEST_NOVEL);
    const result = await handlers.list_chapters({});
    expect(result).toContain("尚未写作");
  });

  it("有章节时列出", async () => {
    const handlers = makeToolHandlers(TEST_NOVEL);
    await handlers.write_chapter({ chapter_number: 1, title: "初遇", content: "x" });
    const result = await handlers.list_chapters({});
    expect(result).toContain("001-初遇.md");
  });
});

describe("update_foreshadowing", () => {
  it("新增伏笔", async () => {
    const handlers = makeToolHandlers(TEST_NOVEL);
    const result = await handlers.update_foreshadowing({
      updates: [{ desc: "玉佩", chapter: "第1章", status: "已埋下", expected_resolution: "第5章" }],
    });
    expect(result).toContain("1 条");

    const raw = await fs.readFile(path.join(TEST_DIR, "_foreshadowing.json"), "utf-8");
    const items = JSON.parse(raw);
    expect(items[0].desc).toBe("玉佩");
    expect(items[0].status).toBe("已埋下");
  });

  it("更新已有伏笔状态", async () => {
    const handlers = makeToolHandlers(TEST_NOVEL);
    await handlers.update_foreshadowing({
      updates: [{ desc: "玉佩", chapter: "第1章", status: "已埋下" }],
    });
    await handlers.update_foreshadowing({
      updates: [{ desc: "玉佩", chapter: "第5章", status: "已回收" }],
    });

    const raw = await fs.readFile(path.join(TEST_DIR, "_foreshadowing.json"), "utf-8");
    const items = JSON.parse(raw);
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe("已回收");
  });
});

describe("write_story_so_far / read_story_so_far", () => {
  it("写入并读取故事摘要", async () => {
    const handlers = makeToolHandlers(TEST_NOVEL);
    await handlers.write_story_so_far({ summary: "男主女主初次相遇" });
    const result = await handlers.read_story_so_far({});
    expect(result).toBe("男主女主初次相遇");
  });

  it("无摘要时返回提示", async () => {
    const handlers = makeToolHandlers(TEST_NOVEL);
    const result = await handlers.read_story_so_far({});
    expect(result).toContain("尚无");
  });
});
