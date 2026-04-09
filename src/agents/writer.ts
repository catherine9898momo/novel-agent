/**
 * agents/writer.ts - 写作专用 Agent（GSD Specialized Agent 模式）
 *
 * 职责：每章独立写作，拿到全新上下文
 * 核心：精准注入——只注入本章写作所需的最小上下文集
 *
 * 注入清单（GSD Context Engineering）：
 *   1. 风格指南（始终加载）
 *   2. 大纲 + 人物 + 关系（结构化设定）
 *   3. XML 章节计划（精确指令）
 *   4. 故事摘要（story_so_far，而非全部前文）
 *   5. 上章结尾 2000 字 + 交接备忘
 *   6. 当前伏笔状态
 *   7. 角色声音档案
 *   8. 情绪曲线位置
 *   9. 知识库素材（按标签检索）
 *   10. 用户偏好
 */

import fs from "fs/promises";
import path from "path";
import { agentLoop, type Message, type CompactOptions } from "../agent-loop.js";
import { TOOLS_DEFINITION, makeToolHandlers } from "../tools.js";
import { autoCompress } from "../context-compact.js";
import { endpoints } from "../models.js";
import { getRelevantMaterial, loadPreferences } from "../knowledge-base.js";
import type { TodoList } from "../todo.js";
import type { ChapterMeta } from "../novel-agent.js";
import type { ChapterPlan } from "../xml-plan.js";
import { planToXml } from "../xml-plan.js";
import { extractSkeleton } from "../plan-skeleton.js";
import { analyzePatterns, generatePreemptiveInstruction, DIM_INSTRUCTIONS } from "../rewrite-patterns.js";
import type { NovelState } from "../novel-state.js";
import type { WeakSpot, DimensionScore } from "./reviewer.js";

// ── 写作上下文（精准注入所需的全部信息）──────────────────

export interface WriteContext {
  novelTitle: string;
  novelDir: string;
  styleGuide: string;
  chapterNum: number;
  chapterTitle: string;
  meta: ChapterMeta;

  // 结构化设定
  outline: string;
  characters: string;
  relationships: string;

  // 章节计划（XML 格式或自由文本）
  chapterPlan: ChapterPlan | string;

  // 故事记忆（精准投喂，不堆砌）
  storySoFar: string;
  lastChapterEnding: string;
  lastHandoff: string;

  // 伏笔状态
  foreshadowing: Array<{ desc: string; planted_at: string; status: string; expected_resolution: string }>;

  // 角色声音档案
  voiceProfiles: string;

  // 情绪曲线
  moodEntries: string[];

  // 运行时
  todo: TodoList;
  todoFilepath: string;
  compactOptions: CompactOptions;
  onTool?: (name: string, output: string) => void;

  // 可选：传入状态用于重写模式学习
  novelState?: NovelState;
}

// ── 构建写作 system prompt ───────────────────────────────

function buildWriterSystem(ctx: WriteContext): string {
  const { meta, chapterNum } = ctx;
  const targetWords = meta.target_words ?? 2000;

  // 章节计划：优先 XML 格式
  const planSection = typeof ctx.chapterPlan === "string"
    ? ctx.chapterPlan
    : planToXml(ctx.chapterPlan);

  // 情绪曲线位置
  const moodPositionSection = ctx.moodEntries.length > 0
    ? `\n## 情绪曲线（>>>标记当前章节位置，*标记已完成章节）\n${ctx.moodEntries.join("\n")}\n`
    : "";

  // 故事记忆
  const storySoFarSection = ctx.storySoFar
    ? `\n## 故事摘要（截至上章）\n${ctx.storySoFar}\n`
    : "";
  const lastChapterSection = ctx.lastChapterEnding
    ? `\n## 上一章结尾（保持衔接）\n${ctx.lastChapterEnding}\n`
    : "";
  const handoffSection = ctx.lastHandoff
    ? `\n## 上一章交接备忘（衔接重点）\n${ctx.lastHandoff}\n`
    : "";

  // 伏笔
  const activeForeshadowing = ctx.foreshadowing.filter(f => f.status !== "已回收");
  const foreshadowingSection = activeForeshadowing.length > 0
    ? `\n## 当前未回收伏笔\n${activeForeshadowing.map(f => `- [${f.status}] ${f.desc}（埋于${f.planted_at}，预期回收：${f.expected_resolution}）`).join("\n")}\n`
    : "";

  // 本章写作要求
  const metaLines: string[] = [];
  if (meta.target_words) metaLines.push(`- 目标字数：${meta.target_words} 字`);
  if (meta.mood) metaLines.push(`- 情绪基调：${meta.mood}`);
  if (meta.required_scenes?.length) metaLines.push(`- 必须出现的场景：${meta.required_scenes.join("、")}`);
  if (meta.plot_hooks?.length) metaLines.push(`- 需要埋下的伏笔：${meta.plot_hooks.join("、")}`);
  if (meta.transition_notes) metaLines.push(`- 场景过渡说明：${meta.transition_notes}（场景切换需有情绪或环境的自然过渡，禁止硬切）`);
  const metaSection = metaLines.length > 0 ? `\n## 本章写作要求\n${metaLines.join("\n")}\n` : "";

  return `你是一位古言言情小说作家，正在创作《${ctx.novelTitle}》的${ctx.chapterTitle}。

## 写作风格
${ctx.styleGuide}

## 故事大纲（骨架）
${extractSkeleton(ctx.outline)}

## 人物设定（骨架）
${extractSkeleton(ctx.characters)}

## 人物关系
${ctx.relationships}
${ctx.voiceProfiles ? `\n## 角色声音档案（对话时严格保持各角色的语言风格一致性）\n${ctx.voiceProfiles}\n` : ""}${moodPositionSection}${storySoFarSection}${lastChapterSection}${handoffSection}${foreshadowingSection}${metaSection}
## 本章写作计划（请严格按此计划创作）
${planSection}

## 写作规则
- 本章不少于 ${targetWords} 字，人物言行必须符合人物设定，剧情必须与故事摘要保持连贯
- 场景切换必须有情绪或环境的自然过渡，禁止硬切
- 写完后调用 write_chapter 保存，chapter_number=${chapterNum}
- 保存成功后调用 write_story_so_far，更新截至本章的故事摘要（包含本章新发生的事件）
- 然后调用 write_handoff，写本章交接备忘（结尾情绪状态、未完成的对话或动作、需要下一章衔接的线索，200字以内）
- 然后调用 update_foreshadowing，更新本章涉及的伏笔状态（新埋的、推进的、已回收的）
- 最后调用 update_todo 将任务 [${ctx.todo.pending().find(i => i.task === ctx.chapterTitle)?.id ?? chapterNum}] 标记为 done
- 完成后回复"本章完成"`;
}

// ── 执行写作 ──────────────────────────────────────────────

export interface WriteResult {
  success: boolean;
  filePath?: string;
  content?: string;
  system: string;     // 供重写时修改后复用
}

export async function runWriterAgent(ctx: WriteContext): Promise<WriteResult> {
  const defaultOnTool = (name: string, output: string) =>
    console.log(`  [工具] ${name}: ${String(output).slice(0, 80)}`);

  // 注入知识库素材
  const knowledgeMaterial = await getRelevantMaterial(
    ctx.meta.mood,
    ctx.meta.required_scenes,
    3,
  );
  const userPrefs = await loadPreferences();

  let system = buildWriterSystem(ctx);

  // 重写模式学习：检测历史低分维度，注入预防性指令
  if (ctx.novelState) {
    const patterns = analyzePatterns(ctx.novelState.data.stats.scores);
    const preemptive = generatePreemptiveInstruction(patterns);
    if (preemptive) {
      system = system + "\n\n" + preemptive;
      console.log(`[模式学习] 检测到 ${patterns.length} 个持续低分维度，已注入预防性指令`);
    }
  }

  // 知识库和用户偏好注入到风格部分之后
  if (knowledgeMaterial) {
    system = system.replace(
      "## 故事大纲",
      `${knowledgeMaterial}\n## 故事大纲`,
    );
  }
  if (userPrefs) {
    system = system.replace(
      "## 故事大纲",
      `\n## 用户写作偏好（必须遵守，来自历史反馈沉淀）\n${userPrefs}\n\n## 故事大纲`,
    );
  }

  // 全新上下文——GSD 核心：每个 executor 拿到干净的 200k 窗口
  const messages: Message[] = [
    { role: "user", content: `请创作《${ctx.novelTitle}》${ctx.chapterTitle}。直接写正文，写完保存并更新故事摘要和任务状态。` },
  ];

  const compactFn = async (): Promise<string> => {
    const compressed = await autoCompress(
      endpoints.compress.client, endpoints.compress.model, messages, 0,
    );
    return compressed ? "上下文已压缩。" : "压缩失败。";
  };

  const handlers = makeToolHandlers(ctx.novelTitle, ctx.todo, compactFn, ctx.todoFilepath);

  await agentLoop(
    endpoints.write.client, endpoints.write.model,
    system, messages, TOOLS_DEFINITION, handlers,
    ctx.onTool ?? defaultOnTool, ctx.compactOptions,
  );

  // 读取写好的章节文件
  const prefix = String(ctx.chapterNum).padStart(3, "0");
  const writtenFiles = await fs.readdir(ctx.novelDir).catch((): string[] => []);
  const writtenFile = writtenFiles.find((f) => f.startsWith(prefix) && !f.startsWith("_"));

  if (!writtenFile) {
    return { success: false, system };
  }

  const content = await fs.readFile(path.join(ctx.novelDir, writtenFile), "utf-8").catch(() => "");
  return {
    success: true,
    filePath: path.join(ctx.novelDir, writtenFile),
    content,
    system,
  };
}

// ── 多版本开头选择 ──────────────────────────────────────────

/**
 * 生成 N 个不同风格的开头段落，让用户选择
 * 返回选中的开头文本，会注入到后续写作 messages 中
 */
export async function generateOpeningVariants(
  ctx: WriteContext,
  count = 3,
): Promise<string | null> {
  const { askLine } = await import("../cli.js");
  const knowledgeMaterial = await getRelevantMaterial(ctx.meta.mood, ctx.meta.required_scenes, 3);

  const system = `你是一位古言言情小说作家。请为《${ctx.novelTitle}》${ctx.chapterTitle}生成 ${count} 个不同风格的开头段落（各约 200-300 字）。

## 写作风格
${ctx.styleGuide}
${knowledgeMaterial}
## 人物设定（骨架）
${extractSkeleton(ctx.characters)}

## 本章写作计划
${typeof ctx.chapterPlan === "string" ? ctx.chapterPlan : planToXml(ctx.chapterPlan)}
${ctx.lastChapterEnding ? `\n## 上一章结尾（保持衔接）\n${ctx.lastChapterEnding}\n` : ""}
## 要求
- 每个版本用不同的切入角度（如：环境开篇、对话开篇、动作开篇、内心独白开篇等）
- 用 === 版本 1 === / === 版本 2 === / === 版本 3 === 分隔
- 每个版本独立完整，不要互相引用`;

  const messages: Message[] = [
    { role: "user", content: `请生成 ${count} 个不同的开头段落。` },
  ];

  // 用 plan 端点（便宜）而非 write 端点
  const stream = endpoints.plan.client.messages.stream({
    model: endpoints.plan.model,
    max_tokens: 4000,
    system,
    messages,
  });

  let fullText = "";
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      process.stdout.write(event.delta.text);
      fullText += event.delta.text;
    }
  }
  console.log();

  // 解析版本
  const variants = fullText.split(/===\s*版本\s*\d+\s*===/).filter(v => v.trim().length > 50);
  if (variants.length === 0) {
    console.log("[多版本] 解析失败，使用默认模式");
    return null;
  }

  // 展示并让用户选择
  for (let i = 0; i < variants.length; i++) {
    console.log(`\n${'─'.repeat(20)} 版本 ${i + 1} ${'─'.repeat(20)}`);
    console.log(variants[i].trim());
  }
  console.log('─'.repeat(50));

  const choice = await askLine(`选择开头版本 (1-${variants.length}，直接回车跳过): `);
  if (!choice || choice.trim() === "") return null;

  const idx = parseInt(choice, 10) - 1;
  if (idx >= 0 && idx < variants.length) {
    console.log(`[多版本] 已选择版本 ${idx + 1}`);
    return variants[idx].trim();
  }
  return null;
}

// ── AI 润色（人指定风格目标，AI 按指令调整）────────────────

export interface PolishResult {
  polished: string;
  changes: string;   // AI 的修改说明
}

/**
 * 对已完成章节做定向润色。
 * @param content      原文
 * @param instruction  用户的润色指令（如"对话更克制"、"加强环境描写"、"删掉所有心理独白直写"）
 * @param styleGuide   风格指南
 * @param weakSpots    reviewer 标记的薄弱点（可选，辅助定位）
 */
export async function polishChapter(
  content: string,
  instruction: string,
  styleGuide: string,
  weakSpots?: Array<{ excerpt: string; issue: string; suggestion: string }>,
): Promise<PolishResult> {
  const weakSpotsSection = weakSpots && weakSpots.length > 0
    ? `\n## 审稿标记的薄弱点（重点打磨）\n${weakSpots.map(s => `- "${s.excerpt}" → 问题：${s.issue}，建议：${s.suggestion}`).join("\n")}\n`
    : "";

  const response = await endpoints.write.client.messages.create({
    model: endpoints.write.model,
    max_tokens: 16000,
    messages: [{
      role: "user",
      content: `你是一位古言言情小说的资深润色编辑。请按照用户的润色指令，对以下章节进行定向修改。

## 风格标准
${styleGuide}
${weakSpotsSection}
## 用户润色指令
${instruction}

## 原文
${content}

## 润色规则
- 只改需要改的地方，保留原文的好句子和整体结构
- 不要改变剧情走向和人物关系
- 不要增删大段内容，只做语言层面的打磨
- 修改后的文字必须符合风格标准
- 输出格式：先输出完整的润色后全文，然后在末尾用 === 修改说明 === 分隔，列出你做了哪些修改（简要）`,
    }],
  });

  const rawText = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");

  const parts = rawText.split(/===\s*修改说明\s*===/);
  return {
    polished: parts[0]?.trim() ?? rawText,
    changes: parts[1]?.trim() ?? "（无修改说明）",
  };
}

// ── 重写前清理 ──────────────────────────────────────────────

export async function cleanupForRewrite(novelDir: string, chapterNum: number): Promise<void> {
  const prefix = String(chapterNum).padStart(3, "0");
  const files = await fs.readdir(novelDir).catch((): string[] => []);
  const existing = files.find((f) => f.startsWith(prefix) && !f.startsWith("_"));
  if (existing) {
    await fs.unlink(path.join(novelDir, existing)).catch(() => null);
    console.log(`[重写] 已删除旧版本：${existing}`);
  }
}

// ── 精准重写（Surgical Rewrite）────────────────────────────

// 去除空白后的字符串，用于匹配比较
function norm(s: string): string {
  return s.replace(/\s+/g, "");
}

// 最长公共子串长度（用于模糊匹配）
function longestCommonSubstringLength(a: string, b: string): number {
  // 为性能考虑，限制长度：excerpt 最长 ~50 字，norm 后约 50 字
  const maxLen = Math.min(a.length, b.length, 200);
  const s = a.slice(0, maxLen);
  const t = b.slice(0, maxLen);
  let best = 0;
  for (let i = 0; i < s.length; i++) {
    for (let j = i + 1; j <= s.length; j++) {
      if (t.includes(s.slice(i, j)) && j - i > best) best = j - i;
    }
  }
  return best;
}

/**
 * 在段落列表中找到包含 excerpt 的段落索引。
 * 策略：1) 精确包含（去空白）2) 模糊：最长公共子串 ≥70% overlap 3) 返回 -1 触发降级
 */
export function findParagraph(paragraphs: string[], excerpt: string): number {
  const normExcerpt = norm(excerpt);
  if (!normExcerpt) return -1;

  // 1. 精确包含
  const exact = paragraphs.findIndex(p => norm(p).includes(normExcerpt));
  if (exact >= 0) return exact;

  // 2. 模糊：最长公共子串 / excerpt 长度 ≥ 0.7
  let bestIdx = -1;
  let bestRatio = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    const lcs = longestCommonSubstringLength(norm(paragraphs[i]), normExcerpt);
    const ratio = lcs / normExcerpt.length;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestIdx = i;
    }
  }
  return bestRatio >= 0.7 ? bestIdx : -1;
}

export interface SpotGroup {
  paragraphIndices: number[];   // 涉及的段落索引（已去重排序）
  spots: WeakSpot[];            // 组内所有薄弱点
}

/**
 * 将 weak_spots 按段落索引聚合，相邻（±1）的段落合并为一组，
 * 减少对同一区域的重复重写。
 */
export function groupWeakSpots(spots: WeakSpot[], paragraphs: string[]): SpotGroup[] {
  // Map each spot to its paragraph index
  type IndexedSpot = { idx: number; spot: WeakSpot };
  const indexed: IndexedSpot[] = [];
  for (const spot of spots) {
    const idx = findParagraph(paragraphs, spot.excerpt);
    if (idx >= 0) indexed.push({ idx, spot });
  }

  if (indexed.length === 0) return [];

  // Sort by paragraph index
  indexed.sort((a, b) => a.idx - b.idx);

  // Merge spots within ±1 paragraph distance
  const groups: SpotGroup[] = [];
  for (const { idx, spot } of indexed) {
    const last = groups[groups.length - 1];
    const lastMax = last ? Math.max(...last.paragraphIndices) : -99;
    if (last && idx - lastMax <= 1) {
      if (!last.paragraphIndices.includes(idx)) last.paragraphIndices.push(idx);
      last.spots.push(spot);
    } else {
      groups.push({ paragraphIndices: [idx], spots: [spot] });
    }
  }
  return groups;
}

export interface IntegrityCheckResult {
  ok: boolean;
  reason?: string;
}

/**
 * 重建完整性检查：字数变化、无重复段落。
 */
export function checkReconstructionIntegrity(
  original: string,
  reconstructed: string,
): IntegrityCheckResult {
  const origLen = original.replace(/\s/g, "").length;
  const newLen  = reconstructed.replace(/\s/g, "").length;

  if (newLen < origLen * 0.8) {
    return { ok: false, reason: `字数骤降：${origLen} → ${newLen}（超过20%）` };
  }
  if (newLen > origLen * 1.3) {
    return { ok: false, reason: `字数骤增：${origLen} → ${newLen}（超过30%）` };
  }

  // 检测重复段落（完全相同且非空的段落出现 2+ 次）
  const paras = reconstructed.split(/\n+/).filter(p => p.trim().length > 20);
  const seen = new Set<string>();
  for (const p of paras) {
    const key = norm(p);
    if (seen.has(key)) {
      return { ok: false, reason: `检测到重复段落：「${p.slice(0, 30)}...」` };
    }
    seen.add(key);
  }

  return { ok: true };
}

/**
 * 精准重写入口：只重写 weak_spots 所在段落，保留其余原文。
 * 返回重建后的完整章节文本，若任何环节失败则返回 null（触发全章重写）。
 */
export async function rewriteSection(
  ctx: WriteContext,
  originalContent: string,
  weakSpots: WeakSpot[],
  dimensions?: DimensionScore,
): Promise<string | null> {
  const paragraphs = originalContent.split(/\n/).filter((_, i, arr) => {
    // 保留所有行（含空行作为分隔标记），便于精确重建
    void i; void arr; return true;
  });

  // 按段落内容分组（跳过空行，对实质段落做匹配）
  const nonEmpty = paragraphs.map((p, i) => ({ p, i })).filter(x => x.p.trim().length > 0);
  const contentParagraphs = nonEmpty.map(x => x.p);
  const contentIndices    = nonEmpty.map(x => x.i); // 在原始 paragraphs 数组中的位置

  const groups = groupWeakSpots(weakSpots, contentParagraphs);

  if (groups.length === 0) {
    console.log("[精准重写] 无法定位薄弱段落，降级到全章重写");
    return null;
  }

  // 构建维度相关指令
  const dimKeys = dimensions
    ? (Object.keys(dimensions) as (keyof DimensionScore)[])
        .filter(k => dimensions[k] < 3)
    : [];
  const dimInstructions = dimKeys.map(k => DIM_INSTRUCTIONS[k]).join("\n");

  // 对每个组依次精准重写
  let workingParagraphs = [...paragraphs];

  for (const group of groups) {
    // 找到上下文范围：前 2 段 + 目标段落 + 后 1 段（基于 contentParagraphs 索引）
    const firstContentIdx = group.paragraphIndices[0];
    const lastContentIdx  = group.paragraphIndices[group.paragraphIndices.length - 1];

    const ctxBefore = contentParagraphs.slice(Math.max(0, firstContentIdx - 2), firstContentIdx);
    const ctxTarget = contentParagraphs.slice(firstContentIdx, lastContentIdx + 1);
    const ctxAfter  = contentParagraphs.slice(lastContentIdx + 1, lastContentIdx + 2);

    // 构建 issues + suggestions
    const issueLines = group.spots
      .map(s => `- 问题：${s.issue}\n  原文：「${s.excerpt}」\n  建议：${s.suggestion}`)
      .join("\n");

    const prompt = `你是一位古言言情小说修改编辑。请只重写【需要改写的段落】，保持上下文衔接自然。

## 风格标准
${ctx.styleGuide}
${dimInstructions ? `\n## 本次重点改进维度\n${dimInstructions}\n` : ""}
## 前文（保持衔接，不要改写）
${ctxBefore.join("\n")}

## 需要改写的段落
${ctxTarget.join("\n")}

## 后文锚点（改写后必须能自然衔接到此处，不要改写）
${ctxAfter.join("\n")}

## 薄弱点说明
${issueLines}

## 要求
- 只输出改写后的段落内容，不要包含前文和后文
- 保持与前后文相同的叙述视角和时态
- 改写后段落数量与原始相近（允许 ±1 段）
- 不要添加章节标题或分隔符`;

    const response = await endpoints.write.client.messages.create({
      model: endpoints.write.model,
      max_tokens: 3000,
      messages: [{ role: "user", content: prompt }],
    });

    const rewritten = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("")
      .trim();

    if (!rewritten) {
      console.log("[精准重写] LLM 返回空内容，降级到全章重写");
      return null;
    }

    // 将重写内容替换回 workingParagraphs（基于原始行索引）
    const startLine = contentIndices[firstContentIdx];
    const endLine   = contentIndices[Math.min(lastContentIdx, contentIndices.length - 1)];
    const rewrittenLines = rewritten.split("\n");
    workingParagraphs = [
      ...workingParagraphs.slice(0, startLine),
      ...rewrittenLines,
      ...workingParagraphs.slice(endLine + 1),
    ];
  }

  const reconstructed = workingParagraphs.join("\n");

  // 完整性检查
  const integrity = checkReconstructionIntegrity(originalContent, reconstructed);
  if (!integrity.ok) {
    console.log(`[精准重写] 完整性检查失败：${integrity.reason}，降级到全章重写`);
    return null;
  }

  return reconstructed;
}
