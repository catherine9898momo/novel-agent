/**
 * agents/researcher.ts - 分析/研究专用 Agent（GSD Research Phase 模式）
 *
 * 职责：
 *   1. 全文分析：重建故事状态（摘要、伏笔、断点、章节元数据）
 *   2. 角色声音档案提取
 *   3. 已有章节内容加载
 *
 * GSD 核心理念：
 *   - Researcher 在 Planning 之前运行，为 Planner 提供领域知识
 *   - 输出结构化制品文件，供后续 Agent 精准注入
 */

import fs from "fs/promises";
import path from "path";
import { endpoints } from "../models.js";
import type { ChapterMeta, NovelState as DetectedState } from "../novel-agent.js";

// ── 全文分析（重建故事状态）──────────────────────────────

export interface AnalysisResult {
  storySoFar: string;
  chaptersWithMetadata: ChapterMeta[];
  foreshadowing: Array<{
    desc: string;
    planted_at: string;
    status: string;
    expected_resolution: string;
  }>;
  breakpointAnalysis: string;
}

export async function runAnalysisAgent(
  novelTitle: string,
  novelDir: string,
  styleGuide: string,
  state: DetectedState,
): Promise<AnalysisResult | null> {
  console.log("\n── 全文分析：重建故事状态 ────────────────────────────");

  // 读取所有已写章节
  const files = await fs.readdir(novelDir).catch((): string[] => []);
  const chapterFiles = files
    .filter((f) => /^\d{3}-/.test(f) && f.endsWith(".md"))
    .sort();

  if (chapterFiles.length === 0) {
    console.log("[分析] 无已写章节，跳过全文分析");
    return null;
  }

  const chapterTexts: string[] = [];
  for (const file of chapterFiles) {
    const content = await fs.readFile(path.join(novelDir, file), "utf-8").catch(() => "");
    chapterTexts.push(`### ${file}\n${content}`);
  }
  const allChaptersText = chapterTexts.join("\n\n---\n\n");

  // 读取现有规划文件
  const outline = await fs.readFile(path.join(novelDir, "_outline.md"), "utf-8").catch(() => "");
  const characters = await fs.readFile(path.join(novelDir, "_characters.md"), "utf-8").catch(() => "");
  const relationships = await fs.readFile(path.join(novelDir, "_relationships.md"), "utf-8").catch(() => "");
  const chaptersRaw = await fs.readFile(path.join(novelDir, "_chapters.json"), "utf-8").catch(() => "[]");
  const existingChapters = (JSON.parse(chaptersRaw) as (string | ChapterMeta)[]).map(
    (c) => (typeof c === "string" ? { title: c } : c)
  );

  const needsStorySoFar = !state.hasStorySoFar;
  const needsMetadata = !state.chaptersHaveMetadata;

  const tasks: string[] = [];
  if (needsStorySoFar) tasks.push("1. 故事摘要（_story_so_far.md）：截至最后一章的故事摘要，800字以内，包含：主要事件、人物当前状态、未解决的冲突");
  if (needsMetadata) tasks.push("2. 章节元数据补全：为所有章节（包括未写章节）生成完整的 ChapterMeta 对象，包含 target_words、mood、required_scenes、plot_hooks");
  tasks.push("3. 伏笔清单（_foreshadowing.json）：识别已埋但未回收的伏笔，格式：[{desc, planted_at, status, expected_resolution}]");
  tasks.push("4. 断点分析：最后一章写到哪里，下一章应接什么，当前处于三幕结构哪个位置");

  const analysisPrompt = `你是一位资深小说编辑，正在分析《${novelTitle}》的已有内容，重建故事状态。

## 写作风格参考
${styleGuide}

## 故事大纲
${outline}

## 人物设定
${characters}

## 人物关系
${relationships}

## 已写章节全文
${allChaptersText}

## 当前章节列表
${JSON.stringify(existingChapters, null, 2)}

## 分析任务
${tasks.join("\n")}

## 输出要求
请严格按以下 JSON 格式输出，不要有任何额外文字：
{
  "story_so_far": "故事摘要文本（800字以内）",
  "chapters_with_metadata": [
    {
      "title": "章节标题",
      "target_words": 1500,
      "mood": "情绪基调",
      "required_scenes": ["场景1", "场景2"],
      "plot_hooks": ["伏笔1", "伏笔2"]
    }
  ],
  "foreshadowing": [
    {
      "desc": "伏笔描述",
      "planted_at": "第X章",
      "status": "已埋/推进中/已回收",
      "expected_resolution": "预期回收位置"
    }
  ],
  "breakpoint_analysis": "断点分析文本"
}`;

  console.log("[分析] 正在分析全文，生成故事状态...");

  const response = await endpoints.audit.client.messages.create({
    model: endpoints.audit.model,
    max_tokens: 8192,
    messages: [{ role: "user", content: analysisPrompt }],
  });

  const rawText = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");

  const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) ?? rawText.match(/(\{[\s\S]*\})/);
  if (!jsonMatch) {
    console.error("[分析] 无法解析分析结果，跳过");
    return null;
  }

  try {
    const parsed = JSON.parse(jsonMatch[1]) as {
      story_so_far: string;
      chapters_with_metadata: ChapterMeta[];
      foreshadowing: Array<{ desc: string; planted_at: string; status: string; expected_resolution: string }>;
      breakpoint_analysis: string;
    };

    return {
      storySoFar: parsed.story_so_far,
      chaptersWithMetadata: parsed.chapters_with_metadata,
      foreshadowing: parsed.foreshadowing,
      breakpointAnalysis: parsed.breakpoint_analysis,
    };
  } catch {
    console.error("[分析] JSON 解析失败，跳过");
    return null;
  }
}

// ── 角色声音档案提取 ──────────────────────────────────────

export async function extractVoiceProfiles(
  novelDir: string,
  existingChapterNums: number[],
): Promise<string> {
  // 读取缓存
  const profilePath = path.join(novelDir, "_voice_profiles.md");
  const cached = await fs.readFile(profilePath, "utf-8").catch(() => null);
  if (cached) return cached;

  if (existingChapterNums.length === 0) return "";

  // 从已写章节中提取对话片段
  const files = await fs.readdir(novelDir).catch((): string[] => []);
  const dialogues: string[] = [];
  for (const num of existingChapterNums.slice(0, 5)) {
    const prefix = String(num).padStart(3, "0");
    const file = files.find((f) => f.startsWith(prefix) && f.endsWith(".md"));
    if (file) {
      const content = await fs.readFile(path.join(novelDir, file), "utf-8").catch(() => "");
      const lines = content.split("\n").filter((l) => l.includes("\u201c") || l.includes("\u201d"));
      dialogues.push(...lines.slice(0, 10));
    }
  }

  if (dialogues.length === 0) return "";

  const response = await endpoints.extract.client.messages.create({
    model: endpoints.extract.model,
    max_tokens: 1500,
    messages: [{
      role: "user",
      content: `分析以下古言小说对话片段，提取每个角色的语言特征。

${dialogues.join("\n")}

对每个出现的角色，输出：
- 角色名
- 语言风格（简洁/细腻/犀利/温和等）
- 口头习惯（常用句式、比喻习惯）
- 代表性台词（直接引用 1-2 句最能体现其声音的对话）

格式简洁，每个角色 3-4 行即可。`,
    }],
  });

  const profiles = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");

  // 缓存到文件
  await fs.writeFile(profilePath, profiles, "utf-8");
  return profiles;
}

// ── 加载已有章节内容（用于逆向提取规划）────────────────

export async function loadExistingChaptersText(
  novelDir: string,
  nums: number[],
): Promise<string> {
  if (nums.length === 0) return "";
  const files = await fs.readdir(novelDir).catch((): string[] => []);
  const parts: string[] = [];
  for (const num of nums.slice(0, 5)) {
    const prefix = String(num).padStart(3, "0");
    const file = files.find((f) => f.startsWith(prefix));
    if (file) {
      const content = await fs.readFile(path.join(novelDir, file), "utf-8").catch(() => "");
      parts.push(`### ${file}\n${content.slice(0, 1500)}`);
    }
  }
  if (parts.length === 0) return "";
  return `\n## 已有章节内容（请基于此提取/推断设定，不要凭空创作）\n${parts.join("\n\n")}\n`;
}
