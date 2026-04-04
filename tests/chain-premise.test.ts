/**
 * 链路测试：_premise.md 加载 → 注入规划 system prompt
 *
 * 验证：
 * 1. _premise.md 存在时能正确读取
 * 2. 前提内容出现在规划 agent 的 system prompt 中
 * 3. _premise.md 不存在时不影响正常流程
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "novel-premise-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("链路：_premise.md 加载", () => {
  it("存在 _premise.md 时正确读取内容", async () => {
    const premiseContent = "# 故事前提\n男主杨过，女主郭芙，互虐双强";
    await fs.writeFile(path.join(tmpDir, "_premise.md"), premiseContent, "utf-8");

    const loaded = await fs.readFile(path.join(tmpDir, "_premise.md"), "utf-8").catch(() => "");
    expect(loaded).toBe(premiseContent);
    expect(loaded).toContain("杨过");
    expect(loaded).toContain("郭芙");
  });

  it("不存在 _premise.md 时返回空字符串", async () => {
    const loaded = await fs.readFile(path.join(tmpDir, "_premise.md"), "utf-8").catch(() => "");
    expect(loaded).toBe("");
  });

  it("premise 注入到 system prompt 的格式正确", () => {
    const premise = "这是一个双强互虐的古言故事";
    const premiseSection = premise
      ? `\n## 故事前提（用户设定，必须严格遵守）\n${premise}\n`
      : "";

    const system = `你是一位资深古言言情小说策划，正在为《偏偏是你》生成故事大纲。
${premiseSection}
## 写作风格参考
古典言情`;

    expect(system).toContain("## 故事前提（用户设定，必须严格遵守）");
    expect(system).toContain("双强互虐");
    // 前提在风格参考之前
    const premiseIdx = system.indexOf("故事前提");
    const styleIdx = system.indexOf("写作风格参考");
    expect(premiseIdx).toBeLessThan(styleIdx);
  });

  it("无 premise 时 system prompt 中不出现前提 section", () => {
    const premise = "";
    const premiseSection = premise
      ? `\n## 故事前提（用户设定，必须严格遵守）\n${premise}\n`
      : "";

    const system = `你是一位资深古言言情小说策划。
${premiseSection}
## 写作风格参考
古典言情`;

    expect(system).not.toContain("故事前提");
  });
});

describe("链路：完整小说目录结构验证", () => {
  it("从空目录到完整规划文件结构", async () => {
    // 模拟完整的小说目录
    const novelDir = path.join(tmpDir, "偏偏是你");
    await fs.mkdir(novelDir, { recursive: true });

    // 写入 premise
    await fs.writeFile(path.join(novelDir, "_premise.md"), "# 前提\n双强互虐");

    // 模拟规划阶段产出
    await fs.writeFile(path.join(novelDir, "_outline.md"), "# 大纲\n三幕结构...");
    await fs.writeFile(path.join(novelDir, "_characters.md"), "# 人物\n杨过：...");
    await fs.writeFile(path.join(novelDir, "_relationships.md"), "# 关系\n...");
    await fs.writeFile(
      path.join(novelDir, "_chapters.json"),
      JSON.stringify([
        { title: "第一章：冤家路窄", mood: "紧张", target_words: 3000 },
        { title: "第二章：唇枪舌剑", mood: "火花", target_words: 3000 },
      ]),
    );

    // 验证 detectState 正确识别
    const { detectState } = await import("../src/novel-agent.js");
    const state = await detectState(novelDir);

    expect(state.hasOutline).toBe(true);
    expect(state.hasCharacters).toBe(true);
    expect(state.hasRelationships).toBe(true);
    expect(state.hasChapters).toBe(true);
    expect(state.chaptersHaveMetadata).toBe(true);
    expect(state.existingChapterNums).toEqual([]);

    // 模拟写了第 1 章
    await fs.writeFile(path.join(novelDir, "001-冤家路窄.md"), "正文内容...");
    const state2 = await detectState(novelDir);
    expect(state2.existingChapterNums).toEqual([1]);

    // 验证 loadChapters
    const { loadChapters } = await import("../src/novel-agent.js");
    const chapters = await loadChapters(novelDir);
    expect(chapters).toHaveLength(2);
    expect(chapters![0].title).toBe("第一章：冤家路窄");
    expect(chapters![0].mood).toBe("紧张");
  });
});
