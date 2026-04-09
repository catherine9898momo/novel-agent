/**
 * surgical-rewrite.test.ts - 精准重写纯函数单测
 *
 * 验证 findParagraph / groupWeakSpots / checkReconstructionIntegrity 的行为：
 *   - 精确匹配
 *   - 模糊匹配（空白差异）
 *   - 无匹配时返回 -1
 *   - 相邻薄弱点合并为一组
 *   - 完整性检查：字数骤降 / 骤增 / 重复段落
 */

import { describe, it, expect } from "vitest";
import {
  findParagraph,
  groupWeakSpots,
  checkReconstructionIntegrity,
} from "../src/agents/writer.js";
import type { WeakSpot } from "../src/agents/reviewer.js";

// ── findParagraph ────────────────────────────────────────

describe("findParagraph", () => {
  const paragraphs = [
    "沈清辞低垂着眸，指尖轻轻摩挲着袖口的暗纹。",
    "\"你来做什么。\" 他的声音平静，像是一汪死水。",
    "萧衍没有回答，只是站在原地，让光线将他半张脸淹没在阴影里。",
    "沉默拉得太长，她终于抬起头，对上那双看不出情绪的眼睛。",
  ];

  it("精确包含匹配", () => {
    const idx = findParagraph(paragraphs, "指尖轻轻摩挲着袖口的暗纹");
    expect(idx).toBe(0);
  });

  it("归一化空白后匹配（多余空格）", () => {
    const idx = findParagraph(paragraphs, "你来  做什么");
    expect(idx).toBe(1);
  });

  it("模糊匹配：excerpt 与段落有 ≥70% 重叠", () => {
    // excerpt 是段落内容的一部分，但有轻微改写（一个字差异）
    const idx = findParagraph(paragraphs, "萧衍没有回答，只是站在原地，让光线将他半边脸淹没在阴影里");
    // "半张脸" vs "半边脸"，其余完全相同，重叠率远超 70%
    expect(idx).toBe(2);
  });

  it("完全不匹配时返回 -1", () => {
    const idx = findParagraph(paragraphs, "完全无关的内容xyz123不可能出现在段落中");
    expect(idx).toBe(-1);
  });

  it("excerpt 为空时返回 -1", () => {
    expect(findParagraph(paragraphs, "")).toBe(-1);
    expect(findParagraph(paragraphs, "   ")).toBe(-1);
  });
});

// ── groupWeakSpots ───────────────────────────────────────

describe("groupWeakSpots", () => {
  const paragraphs = [
    "第一段：主角入场，眉眼含笑。",          // idx 0
    "第二段：两人目光交汇，气氛微妙。",       // idx 1
    "第三段：她心想，他大概不记得自己了。",   // idx 2
    "第四段：侍女端茶进来，打破了沉默。",     // idx 3
    "第五段：他终于开口，声音比想象中低沉。", // idx 4
  ];

  const makeSpot = (excerpt: string): WeakSpot => ({
    excerpt,
    issue: "测试问题",
    suggestion: "测试建议",
  });

  it("相邻段落（±1）的薄弱点合并为一组", () => {
    const spots: WeakSpot[] = [
      makeSpot("主角入场，眉眼含笑"),       // → idx 0
      makeSpot("两人目光交汇，气氛微妙"),   // → idx 1（与 0 相邻，合并）
    ];
    const groups = groupWeakSpots(spots, paragraphs);
    expect(groups).toHaveLength(1);
    expect(groups[0].paragraphIndices).toEqual([0, 1]);
    expect(groups[0].spots).toHaveLength(2);
  });

  it("不相邻段落（距离 > 1）分成不同组", () => {
    const spots: WeakSpot[] = [
      makeSpot("主角入场，眉眼含笑"),         // → idx 0
      makeSpot("她心想，他大概不记得自己了"), // → idx 2（距 0 超过 1，独立组）
    ];
    const groups = groupWeakSpots(spots, paragraphs);
    expect(groups).toHaveLength(2);
    expect(groups[0].paragraphIndices).toEqual([0]);
    expect(groups[1].paragraphIndices).toEqual([2]);
  });

  it("三个连续段落合并为一组", () => {
    const spots: WeakSpot[] = [
      makeSpot("两人目光交汇，气氛微妙"),       // → idx 1
      makeSpot("她心想，他大概不记得自己了"),   // → idx 2
      makeSpot("侍女端茶进来，打破了沉默"),     // → idx 3
    ];
    const groups = groupWeakSpots(spots, paragraphs);
    expect(groups).toHaveLength(1);
    expect(groups[0].paragraphIndices).toEqual([1, 2, 3]);
  });

  it("所有 excerpt 都无法定位时返回空数组", () => {
    const spots: WeakSpot[] = [
      makeSpot("完全不存在的内容abcxyz"),
    ];
    const groups = groupWeakSpots(spots, paragraphs);
    expect(groups).toHaveLength(0);
  });

  it("同一段落的多个薄弱点不重复添加 paragraphIndices", () => {
    const spots: WeakSpot[] = [
      makeSpot("主角入场，眉眼含笑"),  // → idx 0
      makeSpot("眉眼含笑"),            // → idx 0（同段落）
    ];
    const groups = groupWeakSpots(spots, paragraphs);
    expect(groups).toHaveLength(1);
    expect(groups[0].paragraphIndices).toEqual([0]); // 不重复
    expect(groups[0].spots).toHaveLength(2);          // 但 spots 保留两条
  });
});

// ── checkReconstructionIntegrity ─────────────────────────

describe("checkReconstructionIntegrity", () => {
  const base = "沈清辞低垂着眸。".repeat(100); // ~900 字

  it("字数正常范围内通过", () => {
    const result = checkReconstructionIntegrity(base, base);
    expect(result.ok).toBe(true);
  });

  it("字数骤降超 20% 失败", () => {
    const short = "沈清辞低垂着眸。".repeat(50); // 50%
    const result = checkReconstructionIntegrity(base, short);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/字数骤降/);
  });

  it("字数骤增超 30% 失败", () => {
    const long = "沈清辞低垂着眸。".repeat(200); // 200%
    const result = checkReconstructionIntegrity(base, long);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/字数骤增/);
  });

  it("检测到重复段落失败", () => {
    const para = "这是一个非常独特的段落，包含超过二十个字符。";
    const duplicated = `${para}\n\n其他内容...\n\n${para}`;
    const result = checkReconstructionIntegrity(duplicated, duplicated);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/重复段落/);
  });

  it("短段落（≤20字）不触发重复检测", () => {
    const short = "短。\n\n短。\n\n正常内容正常内容正常内容正常内容正常内容正常内容。";
    const result = checkReconstructionIntegrity(short, short);
    expect(result.ok).toBe(true);
  });
});
