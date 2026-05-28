/**
 * context-profiler.ts - Context Engineering 预检工具
 *
 * 目的：在调用 LLM 之前量化 prompt 规模，避免 analyze/audit 把全文越塞越大。
 * 这是生产级 Agent 的预算控制入口：先观测，再决定压缩、分层或拒绝执行。
 */

import fs from "fs/promises";
import path from "path";

export interface ContextFileProfile {
  file: string;
  kind: "planning" | "state" | "chapter" | "style" | "other";
  chars: number;
  estimatedTokens: number;
}

export interface ContextTaskProfile {
  task: "review" | "analyze" | "audit";
  description: string;
  files: ContextFileProfile[];
  promptOverheadChars: number;
  totalChars: number;
  estimatedTokens: number;
  risk: "ok" | "watch" | "high";
  recommendation: string;
}

export interface NovelContextProfile {
  novelName: string;
  chapterCount: number;
  totalChapterChars: number;
  totalPlanningChars: number;
  files: ContextFileProfile[];
  tasks: ContextTaskProfile[];
}

const PLANNING_FILES = ["_outline.md", "_characters.md", "_relationships.md", "_chapters.json"];
const STATE_FILES = ["_story_so_far.md", "_foreshadowing.json", "_todo.json", "_state.json", "STATE.md"];
const ANALYZE_OVERHEAD_CHARS = 1800;
const AUDIT_OVERHEAD_CHARS = 1100;
const REVIEW_OVERHEAD_CHARS = 2600;

export function estimateTokens(text: string): number {
  const cjkChars = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const nonWhitespace = text.replace(/\s/g, "").length;
  const nonCjkChars = Math.max(0, nonWhitespace - cjkChars);
  return Math.ceil(cjkChars + nonCjkChars / 4);
}

function classifyFile(file: string): ContextFileProfile["kind"] {
  if (/^\d{3}-.*\.md$/.test(file)) return "chapter";
  if (PLANNING_FILES.includes(file)) return "planning";
  if (STATE_FILES.includes(file)) return "state";
  if (file.startsWith("_voice")) return "state";
  return "other";
}

async function profileExistingFile(rootDir: string, file: string): Promise<ContextFileProfile | null> {
  const fullPath = path.join(rootDir, file);
  const stat = await fs.stat(fullPath).catch(() => null);
  if (!stat?.isFile()) return null;

  const content = await fs.readFile(fullPath, "utf-8");
  return {
    file,
    kind: classifyFile(file),
    chars: content.length,
    estimatedTokens: estimateTokens(content),
  };
}

function sumChars(files: ContextFileProfile[]): number {
  return files.reduce((sum, file) => sum + file.chars, 0);
}

function riskForTokens(tokens: number): ContextTaskProfile["risk"] {
  if (tokens >= 50000) return "high";
  if (tokens >= 25000) return "watch";
  return "ok";
}

function recommendationFor(task: ContextTaskProfile["task"], risk: ContextTaskProfile["risk"]): string {
  if (task === "review") return "review 只注入单章 + 章节元数据 + 风格指南，当前边界正确。";
  if (risk === "high") return "必须改成分层 Context Pack：早期章节摘要化，最近章节保留全文，并把伏笔/人物状态结构化。";
  if (risk === "watch") return "开始接近需要压缩的区间，下一步应拆 Writer/Review/Audit 的专用 Context Pack。";
  return "当前规模可运行，但 analyze/audit 的全文注入会随章节线性增长，需要持续监控。";
}

function buildTaskProfile(
  task: ContextTaskProfile["task"],
  description: string,
  files: ContextFileProfile[],
  promptOverheadChars: number,
): ContextTaskProfile {
  const totalChars = sumChars(files) + promptOverheadChars;
  const estimatedTokens = files.reduce((sum, file) => sum + file.estimatedTokens, 0) + estimateTokens("x".repeat(promptOverheadChars));
  const risk = riskForTokens(estimatedTokens);
  return {
    task,
    description,
    files,
    promptOverheadChars,
    totalChars,
    estimatedTokens,
    risk,
    recommendation: recommendationFor(task, risk),
  };
}

export async function profileNovelContext(novelName: string, novelDir: string, styleGuide = ""): Promise<NovelContextProfile> {
  const fileNames = await fs.readdir(novelDir);
  const chapterFiles = fileNames.filter((file) => /^\d{3}-.*\.md$/.test(file)).sort();
  const trackedFiles = [...PLANNING_FILES, ...STATE_FILES, ...chapterFiles];

  const profiles = (await Promise.all(trackedFiles.map((file) => profileExistingFile(novelDir, file))))
    .filter((profile): profile is ContextFileProfile => profile !== null);

  const styleProfile: ContextFileProfile = {
    file: "skills/styles/ancient-romance.md",
    kind: "style",
    chars: styleGuide.length,
    estimatedTokens: estimateTokens(styleGuide),
  };

  const planningFiles = profiles.filter((file) => file.kind === "planning");
  const stateFiles = profiles.filter((file) => file.kind === "state");
  const chapterProfiles = profiles.filter((file) => file.kind === "chapter");
  const latestChapter = chapterProfiles.at(-1);

  const reviewFiles = [styleProfile, ...planningFiles.filter((file) => file.file === "_chapters.json")];
  if (latestChapter) reviewFiles.push(latestChapter);

  const analyzeFiles = [styleProfile, ...planningFiles, ...chapterProfiles];
  const auditFiles = [
    ...chapterProfiles,
    ...stateFiles.filter((file) => file.file === "_foreshadowing.json"),
  ];

  const tasks = [
    buildTaskProfile("review", "单章审阅：当前实现读取风格指南、章节元数据和目标章节正文。", reviewFiles, REVIEW_OVERHEAD_CHARS),
    buildTaskProfile("analyze", "全文分析：当前实现读取规划文件和所有已写章节全文。", analyzeFiles, ANALYZE_OVERHEAD_CHARS),
    buildTaskProfile("audit", "连贯性审计：当前实现读取所有已写章节全文和伏笔记录。", auditFiles, AUDIT_OVERHEAD_CHARS),
  ];

  return {
    novelName,
    chapterCount: chapterProfiles.length,
    totalChapterChars: sumChars(chapterProfiles),
    totalPlanningChars: sumChars(planningFiles),
    files: [...profiles, styleProfile].sort((a, b) => b.estimatedTokens - a.estimatedTokens),
    tasks,
  };
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function riskLabel(risk: ContextTaskProfile["risk"]): string {
  if (risk === "high") return "HIGH";
  if (risk === "watch") return "WATCH";
  return "OK";
}

export function formatContextProfile(profile: NovelContextProfile): string {
  const lines: string[] = [];
  lines.push(`\n── Context Profiler: ${profile.novelName} ──────────────────────`);
  lines.push(`章节数: ${profile.chapterCount}`);
  lines.push(`章节正文: ${formatNumber(profile.totalChapterChars)} chars`);
  lines.push(`规划/设定: ${formatNumber(profile.totalPlanningChars)} chars`);

  lines.push("\n文件规模 Top 8:");
  for (const file of profile.files.slice(0, 8)) {
    lines.push(`  ${file.file.padEnd(32)} ${formatNumber(file.chars).padStart(8)} chars  ~${formatNumber(file.estimatedTokens).padStart(7)} tok  ${file.kind}`);
  }

  lines.push("\n任务级 Context 估算:");
  for (const task of profile.tasks) {
    lines.push(`  ${task.task.padEnd(7)} [${riskLabel(task.risk)}] ${formatNumber(task.totalChars).padStart(8)} chars  ~${formatNumber(task.estimatedTokens).padStart(7)} tok`);
    lines.push(`          ${task.description}`);
    lines.push(`          ${task.recommendation}`);
  }

  lines.push("\nL3 概念落点:");
  lines.push("  Context Engineering = 不同任务只拿完成任务所需的最小上下文，而不是全文塞入。");
  lines.push("  Production Control = 在昂贵 LLM 调用前做预算预检，让流程可观测、可拒绝、可演进。");
  lines.push("");
  return lines.join("\n");
}
