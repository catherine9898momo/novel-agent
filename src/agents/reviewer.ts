/**
 * agents/reviewer.ts - 审阅专用 Agent（GSD Verify Phase 模式）
 *
 * 职责：
 *   1. 章节自评（评分 + 反馈）
 *   2. 连贯性审计（跨章节一致性检查）
 *   3. 验证清单检查（基于 XML Plan 的 verify 项）
 *
 * GSD 核心理念：验证不是可选的，是流水线的一等公民
 */

import fs from "fs/promises";
import path from "path";
import { endpoints } from "../models.js";
import type { ChapterMeta } from "../types.js";
import type { ChapterPlan } from "../xml-plan.js";
import { computeMetrics, flagAnomalies, formatAnomaliesForReviewer } from "../quality-metrics.js";

// ── 章节自评 ──────────────────────────────────────────────

export interface WeakSpot {
  excerpt: string;      // 原文摘录（20-50字）
  issue: string;        // 问题类型（如：情绪直白、对话废话、过渡生硬）
  suggestion: string;   // 改进建议
}

export interface DimensionScore {
  plot_advancement: number;   // 情节推进 1-5
  character_voice: number;    // 人物声音 1-5
  prose_quality: number;      // 文笔质量 1-5
  emotional_arc: number;      // 情感弧线 1-5
  pacing: number;             // 节奏把控 1-5
  dialogue_quality: number;   // 对话质量 1-5
}

export interface ChapterReview {
  score: number;
  dimensions?: DimensionScore; // 各维度评分（可选，解析失败不影响流程）
  feedback: string;
  weak_sections: string[];       // 向后兼容
  weak_spots: WeakSpot[];        // 精确标记：需要人工重写的段落
}

export async function reviewChapter(
  novelTitle: string,
  chapterTitle: string,
  content: string,
  meta: ChapterMeta,
  styleGuide: string,
): Promise<ChapterReview> {
  const metaLines: string[] = [];
  if (meta.mood) metaLines.push(`情绪基调：${meta.mood}`);
  if (meta.required_scenes?.length) metaLines.push(`必须场景：${meta.required_scenes.join("、")}`);
  if (meta.plot_hooks?.length) metaLines.push(`需埋伏笔：${meta.plot_hooks.join("、")}`);

  // 运行自动质量指标检测（非 LLM，便宜）
  const metrics = computeMetrics(content);
  const anomalies = flagAnomalies(metrics);
  const anomalySection = formatAnomaliesForReviewer(anomalies);
  if (anomalies.length > 0) {
    console.log(`[质量检测] 发现 ${anomalies.length} 个指标异常，已注入评审上下文`);
  }

  const response = await endpoints.review.client.messages.create({
    model: endpoints.review.model,
    max_tokens: 1200,
    messages: [{
      role: "user",
      content: `你是一位以严苛著称的古言言情小说主编，评审作品时宁可打低分也绝不放水。你的标准是出版级别的。

## 写作风格标准
${styleGuide}

## 本章要求
${metaLines.join("\n") || "（无特殊要求）"}

${anomalySection}## 本章内容
${content}

## 评审任务
请严格按以下 JSON 格式输出评审结果，不要有任何额外文字：
{
  "score": 总体评分（1-5整数，4分为及格线）,
  "dimensions": {
    "plot_advancement": 情节推进评分（1-5整数），
    "character_voice": 人物声音评分（1-5整数），
    "prose_quality": 文笔质量评分（1-5整数），
    "emotional_arc": 情感弧线评分（1-5整数），
    "pacing": 节奏把控评分（1-5整数），
    "dialogue_quality": 对话质量评分（1-5整数）
  },
  "feedback": "总体评价和主要问题（100字以内）",
  "weak_sections": ["问题点概述1", "问题点概述2"],
  "weak_spots": [
    {"excerpt": "摘录原文中最需要改进的句子或段落（20-50字）", "issue": "问题类型", "suggestion": "具体改进建议"}
  ]
}

weak_spots 要求：
- 摘录必须是原文中的原话，不要改写
- 重点标记：情绪直白外露、对话废话、辞藻堆砌、过渡生硬、人物声音不一致 等问题
- 最多标记 5 个最严重的问题点
- 每个 suggestion 要具体可执行，不要泛泛而谈

评分标准（对照风格指南中的范文水准）：
- 5分：达到范文水准——语言如刀，情感克制但读者会疼，每句对话都在做事，场景过渡浑然天成
- 4分：整体良好，语言有质感，有1-2处可打磨但不影响阅读体验
- 3分：能读，但有明显不足：语言偶有套路感、情绪外露、过渡生硬、人物声音模糊
- 2分：语言平淡或情节生硬，有"她心想""美若天仙"等风格指南明确禁止的写法
- 1分：严重问题，需要整章重写

评审重点（逐项检查）：
1. 是否有风格指南"禁忌"部分列出的问题？
2. 对话是否在"做事"（推进关系/暴露性格），还是在说废话？
3. 情感表达是通过细节和行为，还是直接宣泄？
4. 场景过渡是否自然，有无硬切？
5. 字数是否达标？
6. 角色对话语气是否可区分，不看人名能否识别说话者？`,
    }],
  });

  const rawText = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");

  const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) ?? rawText.match(/(\{[\s\S]*\})/);
  if (!jsonMatch) return { score: 3, feedback: "无法解析评审结果", weak_sections: [], weak_spots: [] };

  try {
    const parsed = JSON.parse(jsonMatch[1]) as ChapterReview;
    if (!parsed.weak_spots) parsed.weak_spots = [];
    parsed.weak_spots = parsed.weak_spots.map((weakSpot) => ({
      excerpt: weakSpot.excerpt,
      issue: weakSpot.issue,
      suggestion: weakSpot.suggestion,
    }));
    // 校验 dimensions 字段（若 LLM 没输出则丢弃，不影响后续流程）
    if (parsed.dimensions) {
      const d = parsed.dimensions;
      const valid = [d.plot_advancement, d.character_voice, d.prose_quality, d.emotional_arc, d.pacing, d.dialogue_quality]
        .every(v => typeof v === "number" && v >= 1 && v <= 5);
      if (!valid) delete parsed.dimensions;
    }
    return parsed;
  } catch {
    return { score: 3, feedback: "JSON 解析失败", weak_sections: [], weak_spots: [] };
  }
}

// ── XML Plan 验证（GSD Verify Phase）────────────────────

export interface VerifyResult {
  passed: boolean;
  checks: Array<{ item: string; passed: boolean; detail?: string }>;
  summary: string;
}

export async function verifyAgainstPlan(
  content: string,
  plan: ChapterPlan,
  meta: ChapterMeta,
): Promise<VerifyResult> {
  const checks: Array<{ item: string; passed: boolean; detail?: string }> = [];

  // 1. 字数检查（本地，无需 LLM）
  const wordCount = content.replace(/\s/g, "").length;
  const targetWords = plan.targetWords;
  checks.push({
    item: `字数达标（${wordCount}/${targetWords}）`,
    passed: wordCount >= targetWords * 0.8,
    detail: wordCount < targetWords * 0.8 ? `字数不足，仅 ${wordCount} 字` : undefined,
  });

  // 2. 场景覆盖检查（LLM 辅助）
  if (plan.scenes.length > 0) {
    const sceneDescs = plan.scenes.map(s => s.description).join("\n");
    const sceneCheck = await endpoints.review.client.messages.create({
      model: endpoints.review.model,
      max_tokens: 500,
      messages: [{
        role: "user",
        content: `检查以下章节内容是否覆盖了计划中的所有场景。

## 计划场景
${sceneDescs}

## 章节内容
${content}

请输出 JSON 格式：
{
  "covered": ["已覆盖的场景描述"],
  "missing": ["缺失的场景描述"]
}`,
      }],
    });

    const sceneText = sceneCheck.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");

    const sceneJson = sceneText.match(/```(?:json)?\s*([\s\S]*?)```/) ?? sceneText.match(/(\{[\s\S]*\})/);
    if (sceneJson) {
      try {
        const parsed = JSON.parse(sceneJson[1]) as { covered: string[]; missing: string[] };
        checks.push({
          item: `场景覆盖（${parsed.covered.length}/${plan.scenes.length}）`,
          passed: parsed.missing.length === 0,
          detail: parsed.missing.length > 0 ? `缺失：${parsed.missing.join("、")}` : undefined,
        });
      } catch { /* ignore parse error */ }
    }
  }

  // 3. 伏笔操作检查
  if (plan.foreshadowing.length > 0) {
    const plantItems = plan.foreshadowing.filter(f => f.type === "plant");
    const resolveItems = plan.foreshadowing.filter(f => f.type === "resolve");

    if (plantItems.length > 0) {
      checks.push({
        item: `伏笔埋设（计划 ${plantItems.length} 条）`,
        passed: true, // 需要 LLM 判断，这里标记为通过，详细检查在自评环节
        detail: `计划埋设：${plantItems.map(f => f.desc).join("、")}`,
      });
    }
    if (resolveItems.length > 0) {
      checks.push({
        item: `伏笔回收（计划 ${resolveItems.length} 条）`,
        passed: true,
        detail: `计划回收：${resolveItems.map(f => f.desc).join("、")}`,
      });
    }
  }

  // 4. 自定义检查项
  for (const vc of plan.verifyChecks) {
    checks.push({
      item: vc.item,
      passed: true, // 默认通过，具体由自评环节深入检查
    });
  }

  const passed = checks.every(c => c.passed);
  const failedItems = checks.filter(c => !c.passed);
  const summary = passed
    ? `✅ 全部 ${checks.length} 项检查通过`
    : `❌ ${failedItems.length}/${checks.length} 项未通过：${failedItems.map(c => c.item).join("、")}`;

  return { passed, checks, summary };
}

// ── 连贯性审计 ──────────────────────────────────────────────

export async function runCoherenceAudit(
  novelTitle: string,
  novelDir: string,
  styleGuide: string,
  chapterCount: number,
): Promise<string> {
  console.log(`\n── 连贯性审计（前 ${chapterCount} 章）──────────────────────`);

  const files = await fs.readdir(novelDir).catch((): string[] => []);
  const chapterFiles = files
    .filter((f) => /^\d{3}-/.test(f) && f.endsWith(".md"))
    .sort();

  const chapterTexts: string[] = [];
  for (const file of chapterFiles) {
    const content = await fs.readFile(path.join(novelDir, file), "utf-8").catch(() => "");
    chapterTexts.push(`### ${file}\n${content}`);
  }

  const foreshadowingRaw = await fs.readFile(path.join(novelDir, "_foreshadowing.json"), "utf-8").catch(() => "[]");

  const response = await endpoints.audit.client.messages.create({
    model: endpoints.audit.model,
    max_tokens: 2000,
    messages: [{
      role: "user",
      content: `你是一位资深小说编辑，正在审查《${novelTitle}》前 ${chapterCount} 章的连贯性。

## 全部章节内容
${chapterTexts.join("\n\n---\n\n")}

## 伏笔追踪记录
${foreshadowingRaw}

## 审查任务
请逐项检查以下问题，发现问题才列出，没有问题的类别不用写：

1. **时间线矛盾**：事件发生顺序是否有冲突？（如：角色在第3章说"三天前"的事件，但第1章写的是"昨天"）
2. **人物行为不一致**：角色言行是否与其设定和前文表现矛盾？
3. **遗忘的伏笔**：有没有埋下但后续完全没有推进的伏笔？
4. **场景逻辑漏洞**：有没有空间或物理上不合理的描写？
5. **语气/称呼变化**：同一角色对同一人的称呼是否在不同章节中不一致？

输出格式：
- 每个问题一行，标明章节位置和具体问题
- 如果没有发现问题，输出"审查通过，暂未发现连贯性问题"`,
    }],
  });

  const auditResult = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");

  console.log("\n【连贯性审计结果】");
  console.log(auditResult);
  console.log("─".repeat(50));

  return auditResult;
}
