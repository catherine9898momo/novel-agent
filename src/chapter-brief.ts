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

export function getBriefsDir(novelDir: string): string {
  return path.join(novelDir, "_briefs");
}

export function getBriefPath(novelDir: string, chapterNum: number): string {
  return path.join(getBriefsDir(novelDir), `${String(chapterNum).padStart(3, "0")}.json`);
}

export async function loadChapterBrief(novelDir: string, chapterNum: number): Promise<ChapterBrief | null> {
  const raw = await fs.readFile(getBriefPath(novelDir, chapterNum), "utf-8").catch(() => null);
  if (!raw) return null;
  return JSON.parse(raw) as ChapterBrief;
}

export async function saveChapterBrief(novelDir: string, brief: ChapterBrief): Promise<string> {
  const dir = getBriefsDir(novelDir);
  await fs.mkdir(dir, { recursive: true });
  const briefPath = getBriefPath(novelDir, brief.chapter);
  await fs.writeFile(briefPath, JSON.stringify(brief, null, 2), "utf-8");
  return briefPath;
}

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

  return {
    chapter: input.chapterNum,
    title: meta.title,
    mood: meta.mood,
    target_words: meta.target_words,
    purpose: `TODO: 补充第 ${input.chapterNum} 章「${meta.title}」在主线中的功能。`,
    required_scenes: meta.required_scenes ?? [],
    emotional_beats: [
      "TODO: 起始情绪",
      "TODO: 中段转折",
      "TODO: 章末余韵",
    ],
    foreshadowing: meta.plot_hooks ?? [],
    ending_hook: "TODO: 补充本章结尾钩子，说明读者为什么想继续看下一章。",
    must_not: [
      "TODO: 补充本章不能提前揭露或不能突变的设定。",
    ],
    source_context: {
      chapter_meta: JSON.stringify(meta, null, 2),
      story_so_far: input.storySoFar ? input.storySoFar.slice(0, 1200) : undefined,
      previous_chapter: input.previousChapterExcerpt
        ? `### ${input.previousChapterTitle ?? "上一章"}\n${input.previousChapterExcerpt.slice(0, 1200)}`
        : undefined,
    },
  };
}
