/**
 * xml-plan.ts - XML 结构化章节计划（GSD XML Prompt 模式）
 *
 * GSD 核心洞察：XML 比自由文本更精准，减少 AI 猜测空间
 *
 * 每个章节计划用 XML 格式描述：
 *   - 场景列表（含情绪目标和过渡说明）
 *   - 伏笔操作（埋下/推进/回收）
 *   - 开篇钩子和结尾钩子
 *   - 验证清单（写完后自动检查）
 *
 * 生成流程：
 *   LLM 生成自由文本计划 → 解析为 ChapterPlan 结构 → 输出 XML 注入写作 prompt
 */

import type { ChapterMeta } from "./novel-agent.js";
import { endpoints } from "./models.js";

// ── 类型定义 ──────────────────────────────────────────────

export interface ScenePlan {
  order: number;
  description: string;
  emotion: string;
  transition?: string;   // 与下一场景的过渡
}

export interface ForeshadowingAction {
  type: "plant" | "advance" | "resolve";
  desc: string;
  detail?: string;       // plant: resolve_by; advance: from→to; resolve: 回收方式
}

export interface VerifyCheck {
  item: string;
}

export interface ChapterPlan {
  chapterNum: number;
  title: string;
  pov: string;           // 视角角色
  setting: string;       // 场景地点
  emotionalArc: { from: string; to: string };
  scenes: ScenePlan[];
  foreshadowing: ForeshadowingAction[];
  openingHook: string;
  closingHook: string;
  verifyChecks: VerifyCheck[];
  targetWords: number;
}

// ── XML 生成 ──────────────────────────────────────────────

export function planToXml(plan: ChapterPlan): string {
  const lines: string[] = [
    `<chapter_plan num="${plan.chapterNum}" title="${escapeXml(plan.title)}">`,
    `  <pov>${escapeXml(plan.pov)}</pov>`,
    `  <setting>${escapeXml(plan.setting)}</setting>`,
    `  <emotional_arc from="${escapeXml(plan.emotionalArc.from)}" to="${escapeXml(plan.emotionalArc.to)}" />`,
    `  <target_words>${plan.targetWords}</target_words>`,
    "",
    "  <scenes>",
  ];

  for (const scene of plan.scenes) {
    lines.push(`    <scene order="${scene.order}">`);
    lines.push(`      <description>${escapeXml(scene.description)}</description>`);
    lines.push(`      <emotion>${escapeXml(scene.emotion)}</emotion>`);
    if (scene.transition) {
      lines.push(`      <transition>${escapeXml(scene.transition)}</transition>`);
    }
    lines.push("    </scene>");
  }
  lines.push("  </scenes>");

  if (plan.foreshadowing.length > 0) {
    lines.push("");
    lines.push("  <foreshadowing>");
    for (const f of plan.foreshadowing) {
      const detailAttr = f.detail ? ` detail="${escapeXml(f.detail)}"` : "";
      lines.push(`    <${f.type} desc="${escapeXml(f.desc)}"${detailAttr} />`);
    }
    lines.push("  </foreshadowing>");
  }

  lines.push("");
  lines.push("  <hooks>");
  lines.push(`    <opening>${escapeXml(plan.openingHook)}</opening>`);
  lines.push(`    <closing>${escapeXml(plan.closingHook)}</closing>`);
  lines.push("  </hooks>");

  if (plan.verifyChecks.length > 0) {
    lines.push("");
    lines.push("  <verify>");
    for (const check of plan.verifyChecks) {
      lines.push(`    <check>${escapeXml(check.item)}</check>`);
    }
    lines.push("  </verify>");
  }

  lines.push("</chapter_plan>");
  return lines.join("\n");
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── LLM 生成结构化计划 ──────────────────────────────────

export async function generateXmlChapterPlan(
  novelTitle: string,
  chapterTitle: string,
  meta: ChapterMeta,
  styleGuide: string,
  storySoFar: string,
  lastChapterEnding: string,
  outline: string,
  characters: string,
  foreshadowingState: string,
  feedback?: string,
): Promise<ChapterPlan> {
  const metaLines: string[] = [];
  if (meta.mood) metaLines.push(`情绪基调：${meta.mood}`);
  if (meta.required_scenes?.length) metaLines.push(`必须场景：${meta.required_scenes.join("、")}`);
  if (meta.plot_hooks?.length) metaLines.push(`需埋伏笔：${meta.plot_hooks.join("、")}`);
  if (meta.transition_notes) metaLines.push(`场景过渡说明：${meta.transition_notes}`);

  const feedbackSection = feedback
    ? `\n## 用户反馈（必须按此修改）\n${feedback}\n`
    : "";

  const prompt = `你是一位资深古言言情小说策划。请为《${novelTitle}》的${chapterTitle}制定结构化写作计划。

## 故事大纲
${outline}

## 人物设定
${characters}

## 故事摘要（截至上章）
${storySoFar || "（第一章，无前情）"}

## 上一章结尾
${lastChapterEnding || "（第一章，无前情）"}

## 当前伏笔状态
${foreshadowingState || "（暂无伏笔）"}

## 本章要求
${metaLines.join("\n") || "（无特殊要求）"}

## 写作风格
${styleGuide}
${feedbackSection}
## 输出要求
请严格按以下 JSON 格式输出，不要有任何额外文字：
{
  "pov": "视角角色名",
  "setting": "场景地点（可多个，用 → 连接）",
  "emotional_arc": { "from": "起始情绪", "to": "结束情绪" },
  "scenes": [
    {
      "order": 1,
      "description": "场景描述",
      "emotion": "场景情绪目标",
      "transition": "到下一场景的过渡说明（最后一个场景可省略）"
    }
  ],
  "foreshadowing": [
    {
      "type": "plant/advance/resolve",
      "desc": "伏笔描述",
      "detail": "plant→预期回收章节 / advance→推进说明 / resolve→回收方式"
    }
  ],
  "opening_hook": "开篇钩子（第一段如何入戏）",
  "closing_hook": "结尾钩子（如何让读者想看下一章）",
  "verify_checks": ["验证项1", "验证项2"]
}`;

  const response = await endpoints.plan.client.messages.create({
    model: endpoints.plan.model,
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  const rawText = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");

  // 提取 JSON
  const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) ?? rawText.match(/(\{[\s\S]*\})/);
  if (!jsonMatch) {
    return createFallbackPlan(meta, chapterTitle);
  }

  try {
    const parsed = JSON.parse(jsonMatch[1]) as {
      pov: string;
      setting: string;
      emotional_arc: { from: string; to: string };
      scenes: Array<{ order: number; description: string; emotion: string; transition?: string }>;
      foreshadowing: Array<{ type: string; desc: string; detail?: string }>;
      opening_hook: string;
      closing_hook: string;
      verify_checks: string[];
    };

    // 提取章节编号
    const numMatch = chapterTitle.match(/第(\d+)章/) ?? chapterTitle.match(/(\d+)/);
    const chapterNum = numMatch ? parseInt(numMatch[1], 10) : 1;

    return {
      chapterNum,
      title: chapterTitle,
      pov: parsed.pov,
      setting: parsed.setting,
      emotionalArc: parsed.emotional_arc,
      scenes: parsed.scenes.map((s, i) => ({
        order: s.order ?? i + 1,
        description: s.description,
        emotion: s.emotion,
        transition: s.transition,
      })),
      foreshadowing: (parsed.foreshadowing || []).map((f) => ({
        type: f.type as "plant" | "advance" | "resolve",
        desc: f.desc,
        detail: f.detail,
      })),
      openingHook: parsed.opening_hook,
      closingHook: parsed.closing_hook,
      verifyChecks: (parsed.verify_checks || []).map((item) => ({ item })),
      targetWords: meta.target_words ?? 2000,
    };
  } catch {
    return createFallbackPlan(meta, chapterTitle);
  }
}

function createFallbackPlan(meta: ChapterMeta, chapterTitle: string): ChapterPlan {
  const numMatch = chapterTitle.match(/第(\d+)章/) ?? chapterTitle.match(/(\d+)/);
  const chapterNum = numMatch ? parseInt(numMatch[1], 10) : 1;

  return {
    chapterNum,
    title: chapterTitle,
    pov: "主角",
    setting: "待定",
    emotionalArc: { from: meta.mood ?? "平静", to: meta.mood ?? "波动" },
    scenes: (meta.required_scenes ?? ["主场景"]).map((s, i) => ({
      order: i + 1,
      description: s,
      emotion: meta.mood ?? "待定",
    })),
    foreshadowing: (meta.plot_hooks ?? []).map((h) => ({
      type: "plant" as const,
      desc: h,
    })),
    openingHook: "待定",
    closingHook: "待定",
    verifyChecks: [
      { item: "角色称谓一致" },
      { item: "时间线不矛盾" },
      { item: `字数不少于${meta.target_words ?? 2000}` },
    ],
    targetWords: meta.target_words ?? 2000,
  };
}

// ── 验证计划（写完后检查）────────────────────────────────

export function generateVerifyPrompt(plan: ChapterPlan, content: string): string {
  const checks = plan.verifyChecks.map((c) => `  <check>${c.item}</check>`).join("\n");
  return `<verify_chapter num="${plan.chapterNum}">
  <content_length>${content.length}</content_length>
  <target_words>${plan.targetWords}</target_words>
  <planned_scenes>${plan.scenes.length}</planned_scenes>
  <checks>
${checks}
  </checks>
</verify_chapter>`;
}
