/**
 * novel-agent.ts - 主入口（GSD 重构版）
 *
 * 重构后职责：
 *   1. 导出共享类型（ChapterMeta, NovelState）
 *   2. CLI 入口：小说选择
 *   3. 委派给 Orchestrator 执行全部流程
 *
 * 原有的规划/写作/审阅逻辑已拆分到：
 *   - src/orchestrator.ts      — 薄编排层
 *   - src/agents/planner.ts    — 规划 Agent
 *   - src/agents/writer.ts     — 写作 Agent
 *   - src/agents/reviewer.ts   — 审阅 Agent
 *   - src/agents/researcher.ts — 分析 Agent
 *   - src/novel-state.ts       — STATE.md 会话状态管理
 *   - src/xml-plan.ts          — XML 结构化章节计划
 */

import fs from "fs/promises";
import path from "path";
import { askLine } from "./cli.js";
import { Orchestrator } from "./orchestrator.js";

const NOVELS_DIR = path.resolve("novels");

// ── 共享类型导出（供其他模块引用）────────────────────────────

export interface ChapterMeta {
  title: string;
  target_words?: number;
  mood?: string;
  required_scenes?: string[];
  plot_hooks?: string[];
  transition_notes?: string;
}

export interface NovelState {
  hasOutline: boolean;
  hasCharacters: boolean;
  hasRelationships: boolean;
  hasChapters: boolean;
  hasStorySoFar: boolean;
  chaptersHaveMetadata: boolean;
  existingChapterNums: number[];
}

export async function loadChapters(novelDir: string): Promise<ChapterMeta[] | null> {
  const raw = await fs.readFile(path.join(novelDir, "_chapters.json"), "utf-8").catch(() => null);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as (string | ChapterMeta)[];
  return parsed.map((c) => (typeof c === "string" ? { title: c } : c));
}

// ── 小说选择 ──────────────────────────────────────────────────

async function selectNovel(): Promise<string> {
  const arg = process.argv[2];
  if (arg) return arg;

  await fs.mkdir(NOVELS_DIR, { recursive: true });
  const entries = await fs.readdir(NOVELS_DIR, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  if (dirs.length === 0) {
    const name = await askLine("novels/ 目录为空，请输入新小说标题：");
    return name;
  }

  console.log("\n── 选择小说 ──────────────────────────────");
  dirs.forEach((d, i) => console.log(`  ${i + 1}. ${d}`));
  console.log(`  ${dirs.length + 1}. 新建小说`);

  const input = await askLine("\n请输入序号：");
  const idx = parseInt(input, 10) - 1;

  if (idx === dirs.length) {
    return await askLine("请输入新小说标题：");
  }
  if (idx >= 0 && idx < dirs.length) return dirs[idx];

  console.log("无效输入，退出。");
  process.exit(1);
}

// ── 主流程（委派给 Orchestrator）────────────────────────────

async function main() {
  const novelTitle = await selectNovel();
  const novelDir = path.join(NOVELS_DIR, novelTitle);

  const orchestrator = new Orchestrator(novelTitle, novelDir);
  await orchestrator.run();
}

main().catch(console.error);
