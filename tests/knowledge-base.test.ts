import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";

// Mock the SKILLS_DIR to use a temp directory
let tmpDir: string;
let originalResolve: typeof path.resolve;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "novel-kb-"));
  // We'll re-import the module each time with mocked path
  vi.resetModules();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// Helper: dynamically import with mocked skills dir
async function importKB() {
  // Mock path.resolve to redirect "skills" to tmpDir
  vi.doMock("path", async () => {
    const actual = await vi.importActual<typeof import("path")>("path");
    return {
      ...actual,
      default: {
        ...actual,
        resolve: (...args: string[]) => {
          if (args.length === 1 && args[0] === "skills") return tmpDir;
          return actual.resolve(...args);
        },
      },
      resolve: (...args: string[]) => {
        if (args.length === 1 && args[0] === "skills") return tmpDir;
        return actual.resolve(...args);
      },
    };
  });

  return await import("../src/knowledge-base.js");
}

describe("KnowledgeBase - 索引管理", () => {
  it("空索引：loadIndex 返回空 entries", async () => {
    const kb = await importKB();
    const index = await kb.loadIndex();
    expect(index.entries).toEqual([]);
  });

  it("addEntry: 添加单条素材", async () => {
    const kb = await importKB();
    const entry = await kb.addEntry(
      "example",
      ["对话火花", "人物塑造"],
      "《测试作品》",
      `她说：\u201c你走吧。\u201d他没走。`,
      "克制表达离别",
    );

    expect(entry.id).toMatch(/^example_/);
    expect(entry.type).toBe("example");
    expect(entry.tags).toEqual(["对话火花", "人物塑造"]);
    expect(entry.content).toContain("你走吧");
    expect(entry.note).toBe("克制表达离别");
    expect(entry.createdAt).toBeTruthy();

    // 验证持久化
    const index = await kb.loadIndex();
    expect(index.entries).toHaveLength(1);
  });

  it("addEntries: 批量添加", async () => {
    const kb = await importKB();
    const count = await kb.addEntries([
      { type: "example", tags: ["氛围描写"], source: "A", content: "段落1" },
      { type: "technique", tags: ["伏笔埋设"], source: "B", content: "手法1", note: "示例" },
    ]);

    expect(count).toBe(2);
    const index = await kb.loadIndex();
    expect(index.entries).toHaveLength(2);
    expect(index.entries[0].type).toBe("example");
    expect(index.entries[1].type).toBe("technique");
  });
});

describe("KnowledgeBase - 检索", () => {
  it("searchByTags: 按标签检索", async () => {
    const kb = await importKB();
    await kb.addEntries([
      { type: "example", tags: ["对话火花", "人物塑造"], source: "A", content: "对话段" },
      { type: "example", tags: ["氛围描写", "环境隐喻"], source: "B", content: "环境段" },
      { type: "example", tags: ["对话火花"], source: "C", content: "对话段2" },
    ]);

    const results = await kb.searchByTags(["对话火花"]);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.tags.includes("对话火花"))).toBe(true);
  });

  it("searchByTags: 标签大小写不敏感", async () => {
    const kb = await importKB();
    await kb.addEntry("example", ["对话火花"], "A", "内容");
    const results = await kb.searchByTags(["对话火花"]);
    expect(results).toHaveLength(1);
  });

  it("searchByTags: 按类型过滤", async () => {
    const kb = await importKB();
    await kb.addEntries([
      { type: "example", tags: ["伏笔"], source: "A", content: "佳段" },
      { type: "technique", tags: ["伏笔"], source: "B", content: "手法" },
    ]);

    const examples = await kb.searchByTags(["伏笔"], "example");
    expect(examples).toHaveLength(1);
    expect(examples[0].type).toBe("example");
  });

  it("getByType: 按类型获取全部", async () => {
    const kb = await importKB();
    await kb.addEntries([
      { type: "example", tags: ["a"], source: "A", content: "1" },
      { type: "technique", tags: ["b"], source: "B", content: "2" },
      { type: "example", tags: ["c"], source: "C", content: "3" },
    ]);

    const examples = await kb.getByType("example");
    expect(examples).toHaveLength(2);
  });

  it("getBySource: 按来源检索", async () => {
    const kb = await importKB();
    await kb.addEntries([
      { type: "example", tags: ["a"], source: "《长公主》", content: "1" },
      { type: "example", tags: ["b"], source: "《难为》", content: "2" },
    ]);

    const results = await kb.getBySource("长公主");
    expect(results).toHaveLength(1);
    expect(results[0].source).toContain("长公主");
  });

  it("getAllTags: 统计标签分布", async () => {
    const kb = await importKB();
    await kb.addEntries([
      { type: "example", tags: ["对话", "人物"], source: "A", content: "1" },
      { type: "example", tags: ["对话", "氛围"], source: "B", content: "2" },
    ]);

    const tags = await kb.getAllTags();
    expect(tags["对话"]).toBe(2);
    expect(tags["人物"]).toBe(1);
    expect(tags["氛围"]).toBe(1);
  });
});

describe("KnowledgeBase - 偏好管理", () => {
  it("appendPreference: 追加用户偏好", async () => {
    const kb = await importKB();
    await kb.appendPreference("不要用'轻笑'这种表达", "章节审阅 - 第一章");
    await kb.appendPreference("对话要更犀利", "章节审阅 - 第二章");

    const prefs = await kb.loadPreferences();
    expect(prefs).toContain("轻笑");
    expect(prefs).toContain("犀利");
    expect(prefs).toContain("第一章");
    expect(prefs).toContain("第二章");
  });

  it("loadPreferences: 无偏好文件返回空", async () => {
    const kb = await importKB();
    const prefs = await kb.loadPreferences();
    expect(prefs).toBe("");
  });
});

describe("KnowledgeBase - 格式化输出", () => {
  it("formatForPrompt: 空列表返回空字符串", async () => {
    const kb = await importKB();
    expect(kb.formatForPrompt([], "测试")).toBe("");
  });

  it("formatForPrompt: 格式包含来源和标签", async () => {
    const kb = await importKB();
    const entries = [{
      id: "test1",
      type: "example" as const,
      tags: ["对话火花"],
      source: "《测试》",
      content: "她说走吧",
      note: "克制离别",
      createdAt: "2025-01-01",
    }];

    const output = kb.formatForPrompt(entries, "参考佳段");
    expect(output).toContain("## 参考佳段");
    expect(output).toContain("她说走吧");
    expect(output).toContain("克制离别");
    expect(output).toContain("《测试》");
    expect(output).toContain("对话火花");
  });
});
