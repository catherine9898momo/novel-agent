import { describe, it, expect } from "vitest";
import { sampleChunks } from "../src/analyzer.js";

describe("analyzer - sampleChunks", () => {
  it("短文本：直接分块", () => {
    const text = "第一章 开始\n".repeat(100); // ~1100 chars
    const chunks = sampleChunks(text, 4000);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].position).toBe("开篇");
  });

  it("长文本：8个采样点", () => {
    // 模拟一个长篇小说（~50000 chars）
    const lines: string[] = ["第一章 序幕"];
    for (let i = 0; i < 2000; i++) {
      lines.push(`这是第${i}段正文内容，用来模拟长篇小说的文本量。`);
    }
    const text = lines.join("\n");
    const chunks = sampleChunks(text, 4000);

    expect(chunks).toHaveLength(8);
    expect(chunks[0].position).toBe("开篇");
    expect(chunks[7].position).toBe("结尾");

    // 验证位置分布
    const positions = chunks.map((c) => c.position);
    expect(positions.filter((p) => p === "前期")).toHaveLength(2);
    expect(positions.filter((p) => p === "中期")).toHaveLength(2);
    expect(positions.filter((p) => p === "后期")).toHaveLength(2);
  });

  it("每个 chunk 不超过 chunkSize", () => {
    const lines: string[] = ["第一章 测试"];
    for (let i = 0; i < 2000; i++) {
      lines.push(`正文第${i}行。`);
    }
    const text = lines.join("\n");
    const chunkSize = 3000;
    const chunks = sampleChunks(text, chunkSize);

    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(chunkSize);
    }
  });

  it("chunk index 从 0 递增", () => {
    const text = "第一章\n" + "内容。\n".repeat(5000);
    const chunks = sampleChunks(text, 4000);
    chunks.forEach((c, i) => {
      expect(c.index).toBe(i);
    });
  });

  it("跳过简介/元数据，从第一章开始", () => {
    const text = [
      "书名：测试",
      "作者：测试",
      "简介：一段简介",
      "",
      "第一章 开篇",
      "正文内容开始了。",
      "更多内容。".repeat(500),
    ].join("\n");

    const chunks = sampleChunks(text, 4000);
    // 第一个 chunk 不应包含简介
    expect(chunks[0].text).not.toContain("简介：");
    expect(chunks[0].text).toContain("第一章");
  });
});
