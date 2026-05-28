/**
 * main.ts - 轻量 CLI 工具集
 *
 * 精简后的工作流：
 *   1. 你和 AI 对话写每一章（在 IDE 中完成）
 *   2. npm run metrics <novel> [chapter]  — 跑质量指标
 *   3. npm run review <novel> <chapter>   — AI 审阅单章
 *   4. npm run analyze <novel>            — AI 分析全文状态
 *   5. npm run audit <novel>              — AI 跨章连贯性审计
 *
 * 创作环节靠人机对话，管理环节靠工程。
 */

import fs from "fs/promises";
import path from "path";
import { computeMetrics, flagAnomalies } from "./quality-metrics.js";
import { endpoints, printModelConfig } from "./models.js";
import type { ChapterMeta } from "./types.js";
import { loadChapters } from "./types.js";
import { formatContextProfile, profileNovelContext } from "./context-profiler.js";
import { generateChapterBriefDraft, loadChapterBrief, saveChapterBrief } from "./chapter-brief.js";
import { NovelState } from "./novel-state.js";

const NOVELS_DIR = path.resolve("novels");

// ── 辅助 ────────────────────────────────────────────────

async function loadStyle(styleName: string): Promise<string> {
  const p = path.resolve("skills", "styles", `${styleName}.md`);
  return await fs.readFile(p, "utf-8").catch(() => "");
}

async function resolveNovelDir(name: string): Promise<string> {
  const dir = path.join(NOVELS_DIR, name);
  await fs.access(dir);
  return dir;
}

async function listChapterFiles(novelDir: string): Promise<string[]> {
  const files = await fs.readdir(novelDir).catch((): string[] => []);
  return files.filter((f) => /^\d{3}-/.test(f) && f.endsWith(".md")).sort();
}

function parseChapterNum(arg: string): number {
  return parseInt(arg, 10);
}

// ── metrics: 纯文本质量指标 ─────────────────────────────

async function cmdMetrics(novelName: string, chapterArg?: string) {
  const novelDir = await resolveNovelDir(novelName);
  const chapterFiles = await listChapterFiles(novelDir);

  const targets = chapterArg
    ? chapterFiles.filter((f) => f.startsWith(String(parseChapterNum(chapterArg)).padStart(3, "0")))
    : chapterFiles;

  if (targets.length === 0) {
    console.log("未找到章节文件");
    return;
  }

  for (const file of targets) {
    const content = await fs.readFile(path.join(novelDir, file), "utf-8");
    const metrics = computeMetrics(content);
    const anomalies = flagAnomalies(metrics);
    const chars = content.replace(/[\s#\-—]/g, "").length;

    console.log(`\n── ${file} (${chars} 字) ──────────────────────`);
    console.log(`  对话占比:     ${metrics.dialogueRatio}`);
    console.log(`  平均句长:     ${metrics.avgSentenceLength}`);
    console.log(`  句长变异:     ${metrics.sentenceLengthCV}`);
    console.log(`  段落变异:     ${metrics.paragraphLengthCV}`);
    console.log(`  感叹号密度:   ${metrics.exclamationDensity}`);
    console.log(`  副词密度:     ${metrics.adverbDensity}`);
    console.log(`  禁忌词密度:   ${metrics.tabooPhraseDensity}`);
    console.log(`  直白心理密度: ${metrics.explicitThoughtDensity}`);

    if (anomalies.length === 0) {
      console.log("  ✓ 无异常");
    } else {
      for (const a of anomalies) {
        console.log(`  ⚠ ${a.metric}: ${a.message}`);
      }
    }
  }
}

// ── review: AI 审阅单章 ─────────────────────────────────

async function cmdReview(novelName: string, chapterArg: string) {
  const novelDir = await resolveNovelDir(novelName);
  const chapterFiles = await listChapterFiles(novelDir);
  const num = parseChapterNum(chapterArg);
  const prefix = String(num).padStart(3, "0");
  const file = chapterFiles.find((f) => f.startsWith(prefix));
  if (!file) {
    console.log(`未找到第 ${num} 章`);
    return;
  }

  printModelConfig();

  const content = await fs.readFile(path.join(novelDir, file), "utf-8");
  const styleGuide = await loadStyle("ancient-romance");
  const chapters = await loadChapters(novelDir);
  const meta: ChapterMeta = chapters?.[num - 1] ?? { title: file };

  const { reviewChapter } = await import("./agents/reviewer.js");
  const review = await reviewChapter(novelName, file, content, meta, styleGuide);

  console.log(`\n── 审阅结果: ${file} ──────────────────────`);
  console.log(`  总分: ${review.score}/5`);
  if (review.dimensions) {
    const d = review.dimensions;
    console.log(`  情节推进: ${d.plot_advancement}  人物声音: ${d.character_voice}  文笔: ${d.prose_quality}`);
    console.log(`  情感弧线: ${d.emotional_arc}  节奏: ${d.pacing}  对话: ${d.dialogue_quality}`);
  }
  console.log(`\n  ${review.feedback}`);
  if (review.weak_spots.length > 0) {
    console.log("\n  需改进:");
    for (const ws of review.weak_spots) {
      console.log(`    「${ws.excerpt}」`);
      console.log(`     问题: ${ws.issue}`);
      console.log(`     建议: ${ws.suggestion}\n`);
    }
  }
}

// ── analyze: AI 全文分析 ─────────────────────────────────

async function cmdAnalyze(novelName: string) {
  const novelDir = await resolveNovelDir(novelName);
  printModelConfig();

  const styleGuide = await loadStyle("ancient-romance");

  // 检测状态
  const hasOutline = await fs.access(path.join(novelDir, "_outline.md")).then(() => true).catch(() => false);
  const hasCharacters = await fs.access(path.join(novelDir, "_characters.md")).then(() => true).catch(() => false);
  const hasRelationships = await fs.access(path.join(novelDir, "_relationships.md")).then(() => true).catch(() => false);
  const hasChapters = await fs.access(path.join(novelDir, "_chapters.json")).then(() => true).catch(() => false);
  const hasStorySoFar = await fs.access(path.join(novelDir, "_story_so_far.md")).then(() => true).catch(() => false);

  const chapterFiles = await listChapterFiles(novelDir);
  const existingChapterNums = chapterFiles.map((f) => parseInt(f.slice(0, 3), 10));

  const state = {
    hasOutline,
    hasCharacters,
    hasRelationships,
    hasChapters,
    hasStorySoFar,
    chaptersHaveMetadata: false,
    existingChapterNums,
  };

  const { runAnalysisAgent } = await import("./agents/researcher.js");
  const result = await runAnalysisAgent(novelName, novelDir, styleGuide, state);

  if (result) {
    // 保存产物
    await fs.writeFile(path.join(novelDir, "_story_so_far.md"), result.storySoFar, "utf-8");
    console.log("\n✓ _story_so_far.md 已更新");

    if (result.foreshadowing.length > 0) {
      await fs.writeFile(path.join(novelDir, "_foreshadowing.json"), JSON.stringify(result.foreshadowing, null, 2), "utf-8");
      console.log(`✓ _foreshadowing.json 已更新（${result.foreshadowing.length} 条伏笔）`);
    }

    console.log(`\n── 断点分析 ──\n${result.breakpointAnalysis}`);
  }
}

// ── audit: 跨章连贯性审计 ────────────────────────────────

async function cmdAudit(novelName: string) {
  const novelDir = await resolveNovelDir(novelName);
  printModelConfig();

  const styleGuide = await loadStyle("ancient-romance");
  const chapterFiles = await listChapterFiles(novelDir);

  const { runCoherenceAudit } = await import("./agents/reviewer.js");
  await runCoherenceAudit(novelName, novelDir, styleGuide, chapterFiles.length);
}

// ── context: LLM 调用前的上下文规模预检 ─────────────────────

async function cmdContext(novelName: string) {
  const novelDir = await resolveNovelDir(novelName);
  const styleGuide = await loadStyle("ancient-romance");
  const profile = await profileNovelContext(novelName, novelDir, styleGuide);
  console.log(formatContextProfile(profile));
}

// ── plan: 生成章节 Brief（pending -> planned）────────────────

async function cmdPlan(novelName: string, chapterArg: string) {
  const novelDir = await resolveNovelDir(novelName);
  const chapterNum = parseChapterNum(chapterArg);
  if (!Number.isFinite(chapterNum) || chapterNum <= 0) {
    console.log("章节号必须是正整数");
    return;
  }

  const existingBrief = await loadChapterBrief(novelDir, chapterNum);
  if (existingBrief) {
    console.log(`\n── 已存在 Chapter Brief: 第 ${chapterNum} 章 ──────────────────────`);
    console.log(`标题: ${existingBrief.title}`);
    console.log(`目的: ${existingBrief.purpose}`);
    console.log(`路径: novels/${novelName}/_briefs/${String(chapterNum).padStart(3, "0")}.json`);
    return;
  }

  const chapters = await loadChapters(novelDir);
  const meta = chapters?.[chapterNum - 1];
  if (!meta) {
    console.log(`未找到第 ${chapterNum} 章的章节元数据，请先检查 _chapters.json`);
    return;
  }

  const storySoFar = await fs.readFile(path.join(novelDir, "_story_so_far.md"), "utf-8").catch(() => "");
  const chapterFiles = await listChapterFiles(novelDir);
  const previousPrefix = String(chapterNum - 1).padStart(3, "0");
  const previousFile = chapterFiles.find((file) => file.startsWith(previousPrefix));
  const previousChapterExcerpt = previousFile
    ? await fs.readFile(path.join(novelDir, previousFile), "utf-8").catch(() => "")
    : undefined;

  const brief = await generateChapterBriefDraft({
    novelName,
    chapterNum,
    novelDir,
    meta,
    storySoFar,
    previousChapterTitle: previousFile,
    previousChapterExcerpt,
  });
  const briefPath = await saveChapterBrief(novelDir, brief);

  const state = await NovelState.load(novelDir, novelName, "ancient-romance");
  await state.setCurrentChapter(chapterNum);
  await state.updateChapterProgress(chapterNum, "planned", briefPath);

  console.log(`\n✓ 已生成 Chapter Brief: 第 ${chapterNum} 章`);
  console.log(`标题: ${brief.title}`);
  console.log(`状态: planned`);
  console.log(`路径: novels/${novelName}/_briefs/${String(chapterNum).padStart(3, "0")}.json`);
  console.log("\n下一步：打开 brief，把 TODO 补成真实章节概览。");
}

// ── 入口 ────────────────────────────────────────────────

const [cmd, ...args] = process.argv.slice(2);

const USAGE = `
用法:
  npm run metrics <小说名> [章节号]    质量指标检测
  npm run review  <小说名> <章节号>    AI 审阅单章
  npm run context <小说名>             上下文规模预检
  npm run plan    <小说名> <章节号>    生成章节 Brief
  npm run analyze <小说名>             AI 全文状态分析
  npm run audit   <小说名>             AI 跨章连贯性审计
`;

async function run() {
  switch (cmd) {
    case "metrics":
      if (!args[0]) { console.log(USAGE); return; }
      await cmdMetrics(args[0], args[1]);
      break;
    case "review":
      if (!args[0] || !args[1]) { console.log(USAGE); return; }
      await cmdReview(args[0], args[1]);
      break;
    case "context":
      if (!args[0]) { console.log(USAGE); return; }
      await cmdContext(args[0]);
      break;
    case "plan":
      if (!args[0] || !args[1]) { console.log(USAGE); return; }
      await cmdPlan(args[0], args[1]);
      break;
    case "analyze":
      if (!args[0]) { console.log(USAGE); return; }
      await cmdAnalyze(args[0]);
      break;
    case "audit":
      if (!args[0]) { console.log(USAGE); return; }
      await cmdAudit(args[0]);
      break;
    default:
      console.log(USAGE);
  }
}

run().catch((e) => { console.error(e.message); process.exit(1); });
