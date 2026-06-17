/**
 * chapter-brief.ts - 章节概览（Brief）中间产物
 *
 * Brief 是 Planner Agent 和 Writer Agent 之间的契约：
 *   pending -> planned: 先决定这一章写什么
 *   planned -> drafted: 再基于 brief 写完整正文
 *
 * 当前文件先搭框架；真正的规划智能留在 generateChapterBriefDraft() 里补。
 */

import fs from "fs/promises";
import path from "path";
import type { ChapterMeta } from "./types.js";

export interface ChapterBrief {
  chapter: number;
  title: string;
  mood?: string;
  target_words?: number;
  purpose: string;
  required_scenes: string[];
  emotional_beats: string[];
  foreshadowing: string[];
  ending_hook: string;
  must_not: string[];
  source_context: {
    chapter_meta: string;
    story_so_far?: string;
    previous_chapter?: string;
  };
}

export interface ChapterBriefInput {
  novelName: string;
  chapterNum: number;
  novelDir: string;
  meta: ChapterMeta;
  storySoFar: string;
  previousChapterTitle?: string;
  previousChapterExcerpt?: string;
}

/**
 * 返回某部小说存放 Chapter Brief 的目录。
 *
 * @param novelDir 小说目录的绝对或相对路径，例如 novels/烟雨长安
 * @returns brief 目录路径，例如 novels/烟雨长安/_briefs
 */
export function getBriefsDir(novelDir: string): string {
  return path.join(novelDir, "_briefs");
}

/**
 * 返回指定章节 brief 的 JSON 文件路径。
 *
 * @param novelDir 小说目录
 * @param chapterNum 章节号，从 1 开始
 * @returns brief 文件路径，例如 novels/烟雨长安/_briefs/006.json
 */
export function getBriefPath(novelDir: string, chapterNum: number): string {
  return path.join(getBriefsDir(novelDir), `${String(chapterNum).padStart(3, "0")}.json`);
}

/**
 * 读取指定章节的 Chapter Brief。
 *
 * @param novelDir 小说目录
 * @param chapterNum 章节号，从 1 开始
 * @returns 如果文件存在，返回解析后的 ChapterBrief；不存在则返回 null
 */
export async function loadChapterBrief(novelDir: string, chapterNum: number): Promise<ChapterBrief | null> {
  const raw = await fs.readFile(getBriefPath(novelDir, chapterNum), "utf-8").catch(() => null);
  if (!raw) return null;
  return JSON.parse(raw) as ChapterBrief;
}

/**
 * 保存 Chapter Brief 到 _briefs/{章节号}.json。
 *
 * @param novelDir 小说目录
 * @param brief 已生成并通过校验的章节概览
 * @returns 写入后的 brief 文件路径
 */
export async function saveChapterBrief(novelDir: string, brief: ChapterBrief): Promise<string> {
  const dir = getBriefsDir(novelDir);
  await fs.mkdir(dir, { recursive: true });
  const briefPath = getBriefPath(novelDir, brief.chapter);
  await fs.writeFile(briefPath, JSON.stringify(brief, null, 2), "utf-8");
  return briefPath;
}

/**
 * 压缩长文本，避免 source_context 把过长的故事摘要或上一章全文带进 brief。
 *
 * @param text 原始文本
 * @param maxChars 最多保留的字符数
 * @returns 空文本返回 undefined；超长文本返回截断版本；否则返回原文
 */
function compactText(text: string, maxChars: number): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}...` : trimmed;
}

/**
 * 根据章节元数据推导“这一章在主线中的功能”。
 *
 * 当前是 deterministic 规则版：从 required_scenes 和 plot_hooks 里抽主场景/主伏笔。
 * 未来接 Planner Agent 时，这个函数可以被 LLM 生成结果替代。
 *
 * @param input 章节 brief 生成所需上下文
 * @returns 一句话章节目的
 */
function inferPurpose(input: ChapterBriefInput): string {
  const scenes = input.meta.required_scenes ?? [];
  const hooks = input.meta.plot_hooks ?? [];
  const mainScene = scenes[0] ?? "推进本章核心事件";
  const mainHook = hooks[0] ?? "延续主线冲突";

  return `通过「${mainScene}」推进第 ${input.chapterNum} 章主线，并让读者更理解「${mainHook}」背后的压力。`;
}

/**
 * 根据章节场景和情绪基调生成三段式情绪节拍。
 *
 * @param meta 当前章节在 _chapters.json 中的元数据
 * @returns 起始、中段、章末三个情绪/剧情推进点
 */
function inferEmotionalBeats(meta: ChapterMeta): string[] {
  const mood = meta.mood ?? "承接、推进";
  const scenes = meta.required_scenes ?? [];

  if (scenes.length >= 3) {
    return [
      `开场承接上一章余波，以「${scenes[0]}」进入${mood}的基调`,
      `中段围绕「${scenes[1]}」制造认知变化或关系压力`,
      `章末落在「${scenes[scenes.length - 1]}」，留下情绪余韵和下一章钩子`,
    ];
  }

  return [
    `开场建立${mood}的情绪基调`,
    "中段通过人物互动推进关系或冲突",
    "章末留下一个未解决的问题，推动读者进入下一章",
  ];
}

/**
 * 根据 plot_hooks 推导章末钩子。
 *
 * @param meta 当前章节元数据
 * @returns 用于指导 Writer 收束章节的 ending hook
 */
function inferEndingHook(meta: ChapterMeta): string {
  const hooks = meta.plot_hooks ?? [];
  if (hooks.length > 0) {
    return `章末点到「${hooks[0]}」，但不完全解释，让它成为下一阶段冲突的入口。`;
  }
  return "章末留下一个具体的新疑问或关系变化，让下一章有明确承接点。";
}

/**
 * 生成本章写作边界，防止 Writer 过度发挥。
 *
 * @param meta 当前章节元数据
 * @returns 本章不应该写出的内容或不应该越过的边界
 */
function inferMustNot(meta: ChapterMeta): string[] {
  const hooks = meta.plot_hooks ?? [];
  const mustNot = [
    "不要让人物关系突然越级亲密，情感推进必须有铺垫。",
    "不要用大段解释替代场景行动，让信息通过对话、细节和选择露出。",
  ];

  if (hooks.length > 0) {
    mustNot.push(`不要提前完整揭露「${hooks[0]}」，本章只推进或加深疑点。`);
  }

  return mustNot;
}

/**
 * 校验 Chapter Brief 是否具备进入 Writer 阶段的最低信息量。
 *
 * @param brief 待校验的章节概览
 * @throws 当 title、purpose、required_scenes、emotional_beats 或 must_not 缺失时抛错
 */
function validateChapterBrief(brief: ChapterBrief): void {
  const errors: string[] = [];
  if (!brief.title.trim()) errors.push("title 不能为空");
  if (!brief.purpose.trim()) errors.push("purpose 不能为空");
  if (brief.required_scenes.length === 0) errors.push("required_scenes 不能为空");
  if (brief.emotional_beats.length === 0) errors.push("emotional_beats 不能为空");
  if (brief.must_not.length === 0) errors.push("must_not 不能为空");

  if (errors.length > 0) {
    throw new Error(`Chapter Brief 校验失败：${errors.join("；")}`);
  }
}

/**
 * 生成章节 Brief 草稿。
 *
 * 当前实现是规则版 Planner：从章节元数据、故事摘要、上一章摘录中生成
 * purpose / emotional_beats / ending_hook / must_not 等结构化字段。
 *
 * 未来实现可以替换成 LLM Planner，但仍应返回同一个 ChapterBrief 结构，
 * 这样 Orchestrator、Writer 和状态机不需要跟着改。
 *
 * @param input 生成 brief 所需的小说名、章节号、章节元数据和上下文摘录
 * @returns 可保存到 _briefs/{章节号}.json 的 ChapterBrief
 */
export async function generateChapterBriefDraft(input: ChapterBriefInput): Promise<ChapterBrief> {
  const meta = input.meta;

  /*
   * TODO(you): 把这里替换成真正的 Planner 逻辑。
   *
   * 伪代码：
   * 1. 读取 Planning Context Pack:
   *    - story_so_far
   *    - _characters.md
   *    - _relationships.md
   *    - 当前章节 meta
   *    - 最近一章摘要/摘录
   *
   * 2. 让 Planner Agent 生成结构化 JSON:
   *    - purpose: 这一章在整本书里的功能
   *    - emotional_beats: 情绪节拍
   *    - ending_hook: 章节收束点/钩子
   *    - must_not: 不能提前揭露、不能突变的人物关系
   *
   * 3. 校验 JSON:
   *    - required_scenes 不为空
   *    - purpose 不为空
   *    - must_not 至少包含 1 条边界
   *
   * 4. 保存为 _briefs/006.json，并把章节状态更新为 planned。
   */

  // 当前实现：先用确定性规则生成一个可编辑 brief。
  // 以后接 Planner Agent 时，替换这里的字段生成逻辑即可，返回的 ChapterBrief 契约不变。
  const brief: ChapterBrief = {
    chapter: input.chapterNum,
    title: meta.title,
    mood: meta.mood,
    target_words: meta.target_words,
    purpose: inferPurpose(input),
    required_scenes: meta.required_scenes ?? [],
    emotional_beats: inferEmotionalBeats(meta),
    foreshadowing: meta.plot_hooks ?? [],
    ending_hook: inferEndingHook(meta),
    must_not: inferMustNot(meta),
    source_context: {
      chapter_meta: JSON.stringify(meta, null, 2),
      story_so_far: compactText(input.storySoFar, 1200),
      previous_chapter: input.previousChapterExcerpt
        ? `### ${input.previousChapterTitle ?? "上一章"}\n${compactText(input.previousChapterExcerpt, 1200)}`
        : undefined,
    },
  };

  validateChapterBrief(brief);
  return brief;
}
