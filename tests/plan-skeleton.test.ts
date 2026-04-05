/**
 * plan-skeleton.test.ts - 骨架提取单测
 *
 * 验证：
 *   - 标题全部保留
 *   - 表格保留
 *   - code block 保留
 *   - 正文只保留首句
 *   - 空行不堆积
 *   - 对真实大纲文件的压缩比
 */

import { describe, it, expect } from "vitest";
import fs from "fs/promises";
import path from "path";
import { extractSkeleton } from "../src/plan-skeleton.js";

describe("extractSkeleton", () => {
  it("保留标题，丢弃正文详细描写", () => {
    const md = `# 标题

## 第一章：初遇
- **目标**：男女主初遇。场景设在北境边城长宁关，风雪夜。姜云笙奉父命押送军需，途中遭山匪伏击。沈渡带裴长青路过，顺手相救——但态度恶劣，救完就走。
- **伏笔**：姜云笙觉得此人声音有几分熟悉。
- **情绪**：紧张刺激。`;

    const skeleton = extractSkeleton(md);
    expect(skeleton).toContain("# 标题");
    expect(skeleton).toContain("## 第一章：初遇");
    // 首句保留
    expect(skeleton).toContain("**目标**：男女主初遇。");
    // 后续行丢弃
    expect(skeleton).not.toContain("伏笔");
    expect(skeleton).not.toContain("情绪");
  });

  it("保留表格", () => {
    const md = `## 三幕结构

| 幕 | 章节 | 主题 |
|---|---|---|
| 第一幕 | 1-8 | 冲撞 |
| 第二幕 | 9-16 | 撕裂 |

正文内容在这里`;

    const skeleton = extractSkeleton(md);
    expect(skeleton).toContain("| 第一幕 | 1-8 | 冲撞 |");
    expect(skeleton).toContain("| 第二幕 | 9-16 | 撕裂 |");
  });

  it("保留 code block", () => {
    const md = `## 关系图

\`\`\`
姜云笙 ← → 沈渡
\`\`\`

详细说明...`;

    const skeleton = extractSkeleton(md);
    expect(skeleton).toContain("姜云笙 ← → 沈渡");
    expect(skeleton).not.toContain("详细说明");
  });

  it("保留分割线", () => {
    const md = `## A

---

## B`;

    const skeleton = extractSkeleton(md);
    expect(skeleton).toContain("---");
  });

  it("首句截断：中文句号", () => {
    const md = `## 测试
这是第一句话。这是第二句话。这是第三句话。`;

    const skeleton = extractSkeleton(md);
    expect(skeleton).toContain("这是第一句话。");
    expect(skeleton).not.toContain("第二句话");
  });

  it("超长行硬截断", () => {
    const longLine = "A".repeat(300);
    const md = `## 标题\n${longLine}`;
    const skeleton = extractSkeleton(md, 150);
    // 应该被截断到 150 + …
    const contentLines = skeleton.split("\n").filter(l => l.startsWith("A"));
    expect(contentLines[0].length).toBeLessThanOrEqual(152); // 150 + "…"(UTF-8)
  });

  it("连续空行不堆积", () => {
    const md = `## A\n\n\n\n\n## B`;
    const skeleton = extractSkeleton(md);
    expect(skeleton).not.toContain("\n\n\n");
  });

  it("真实大纲压缩比测试", async () => {
    const outlinePath = path.resolve("novels/偏偏是你/_outline.md");
    const exists = await fs.access(outlinePath).then(() => true).catch(() => false);
    if (!exists) return; // 跳过：无小说文件

    const original = await fs.readFile(outlinePath, "utf-8");
    const skeleton = extractSkeleton(original);

    const ratio = skeleton.length / original.length;
    console.log(`  骨架提取: ${original.length} → ${skeleton.length} 字符 (${(ratio * 100).toFixed(1)}%)`);

    // 压缩比应该在 10%-40% 之间
    expect(ratio).toBeLessThan(0.5);
    expect(ratio).toBeGreaterThan(0.05);

    // 应该保留所有标题
    expect(skeleton).toContain("## 一句话核心冲突");
    expect(skeleton).toContain("## 三幕结构总览");
    // 应该保留表格
    expect(skeleton).toContain("| 第一幕");
  });
});
