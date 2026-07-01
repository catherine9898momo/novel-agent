import fs from "fs/promises";
import path from "path";
import { MATERIAL_RUNS_ROOT } from "./decomposer.js";
import { FileMaterialStore } from "./store.js";
import type {
  StoryWindow,
  StoryWindowArtifactPaths,
  StoryWindowKind,
  StoryWindowQualityMetrics,
  StoryWindowSource,
  StoryWindowSummary,
} from "./story-window-schema.js";
import type { ChapterChainItem, PlotThreadMaterial } from "./types.js";

export interface BuildStoryWindowsInput {
  sourceId: string;
  chapterCount?: number;
  chapterChain: ChapterChainItem[];
  plotThreads: PlotThreadMaterial[];
  minSize?: number;
  maxSize?: number;
}

export interface BuildStoryWindowsResult {
  windows: StoryWindow[];
  summary: Omit<StoryWindowSummary, "createdAt">;
}

export interface PlanStoryWindowsInput {
  sourceId: string;
  rootDir?: string;
  minSize?: number;
  maxSize?: number;
  now?: () => string;
}

export interface PlanStoryWindowsResult {
  windows: StoryWindow[];
  summary: StoryWindowSummary;
  paths: StoryWindowArtifactPaths;
}

const DEFAULT_MIN_SIZE = 2;
const DEFAULT_MAX_SIZE = 5;
const LOW_CONFIDENCE_THRESHOLD = 0.7;

export function buildStoryWindows(input: BuildStoryWindowsInput): BuildStoryWindowsResult {
  const minSize = input.minSize ?? DEFAULT_MIN_SIZE;
  const maxSize = input.maxSize ?? DEFAULT_MAX_SIZE;
  const chapterCount = input.chapterCount ?? inferChapterCount(input.chapterChain, input.plotThreads);
  const windows: StoryWindow[] = [];

  windows.push(...buildPlotThreadWindows(input.sourceId, input.plotThreads, input.chapterChain, minSize, maxSize));
  if (!windows.some((window) => window.chapterNumbers.includes(1))) {
    windows.unshift(buildFallbackWindow(input.sourceId, range(1, Math.min(2, chapterCount)), input.chapterChain, "opening_arc", "fallback"));
  } else {
    const first = windows.find((window) => window.chapterNumbers.includes(1));
    if (first) {
      first.kind = "opening_arc";
      first.id = buildWindowId(input.sourceId, first.chapterNumbers, first.kind);
    }
  }

  const normalized = dedupeWindows(windows)
    .sort((a, b) => a.chapterNumbers[0] - b.chapterNumbers[0]);
  const filled = fillCoverageGaps(input.sourceId, normalized, input.chapterChain, chapterCount, minSize, maxSize);
  const scored = filled.map((window) => scoreStoryWindow(window, minSize, maxSize));
  const metrics = buildMetrics(scored, chapterCount, minSize, maxSize);

  return {
    windows: scored,
    summary: {
      sourceId: input.sourceId,
      windowCount: scored.length,
      metrics,
    },
  };
}

export async function planStoryWindowsForSource(input: PlanStoryWindowsInput): Promise<PlanStoryWindowsResult> {
  const rootDir = input.rootDir ?? MATERIAL_RUNS_ROOT;
  const store = new FileMaterialStore(rootDir);
  const raw = await store.readRawSplit(input.sourceId);
  const built = buildStoryWindows({
    sourceId: input.sourceId,
    chapterCount: raw.source?.chapterCount,
    chapterChain: raw.chapterChain,
    plotThreads: raw.plotThreads,
    minSize: input.minSize,
    maxSize: input.maxSize,
  });
  const summary: StoryWindowSummary = {
    ...built.summary,
    createdAt: input.now?.() ?? new Date().toISOString(),
  };
  const outputDir = path.join(rootDir, input.sourceId, "windows");
  await fs.mkdir(outputDir, { recursive: true });
  const paths: StoryWindowArtifactPaths = {
    storyWindows: path.join(outputDir, "story-windows.json"),
    preview: path.join(outputDir, "preview.md"),
    qualityReport: path.join(outputDir, "quality-report.md"),
    summary: path.join(outputDir, "summary.json"),
  };

  await Promise.all([
    writeJson(paths.storyWindows, built.windows),
    fs.writeFile(paths.preview, renderStoryWindowPreview(built.windows, summary), "utf-8"),
    fs.writeFile(paths.qualityReport, renderStoryWindowQualityReport(built.windows, summary), "utf-8"),
    writeJson(paths.summary, summary),
  ]);

  return {
    windows: built.windows,
    summary,
    paths,
  };
}

function buildPlotThreadWindows(
  sourceId: string,
  plotThreads: PlotThreadMaterial[],
  chapterChain: ChapterChainItem[],
  minSize: number,
  maxSize: number,
): StoryWindow[] {
  const primaryThreads = plotThreads.filter((thread) => ["mini_arc", "subplot"].includes(thread.kind));
  const primaryWindows = primaryThreads.flatMap((thread) =>
    splitThreadIntoWindows(sourceId, thread, chapterChain, minSize, maxSize),
  );
  const coveredByPrimary = new Set(primaryWindows.flatMap((window) => window.chapterNumbers));
  const phaseWindows = plotThreads
    .filter((thread) => thread.kind === "phase")
    .flatMap((thread) => {
      const uncovered = normalizeChapterNumbers(thread.chapterNumbers).filter((chapter) => !coveredByPrimary.has(chapter));
      return contiguousGroups(uncovered).flatMap((group, index) => {
        const pseudoThread = {
          ...thread,
          id: index === 0 ? thread.id : `${thread.id}-gap-${index + 1}`,
          chapterNumbers: group,
        };
        return splitThreadIntoWindows(sourceId, pseudoThread, chapterChain, minSize, maxSize);
      });
    });

  return [...primaryWindows, ...phaseWindows];
}

function splitThreadIntoWindows(
  sourceId: string,
  thread: PlotThreadMaterial,
  chapterChain: ChapterChainItem[],
  minSize: number,
  maxSize: number,
): StoryWindow[] {
  const numbers = normalizeChapterNumbers(thread.chapterNumbers);
  if (numbers.length <= maxSize) {
    return [buildThreadWindow(sourceId, thread, numbers, chapterChain)];
  }

  const chunks: number[][] = [];
  for (let index = 0; index < numbers.length; index += maxSize) {
    chunks.push(numbers.slice(index, index + maxSize));
  }
  return chunks.map((chunk, index) => buildThreadWindow(sourceId, thread, chunk, chapterChain, index));
}

function buildThreadWindow(
  sourceId: string,
  thread: PlotThreadMaterial,
  chapterNumbers: number[],
  chapterChain: ChapterChainItem[],
  chunkIndex = 0,
): StoryWindow {
  const kind = toWindowKind(thread.kind, chapterNumbers);
  const chapters = chapterChainForNumbers(chapterChain, chapterNumbers);
  const title = chunkIndex === 0 ? thread.title : `${thread.title}（续 ${chunkIndex + 1}）`;
  return {
    id: buildWindowId(sourceId, chapterNumbers, kind),
    chapterRange: formatChapterRange(chapterNumbers),
    chapterNumbers,
    kind,
    title,
    summary: thread.summary || joinChapterField(chapters, "mainEvent"),
    mainConflict: thread.conflict || joinChapterField(chapters, "conflict"),
    involvedCharacters: normalizeInvolvedCharacters(thread.involvedCharacters),
    startReason: buildStartReason(chapters[0], thread),
    endReason: buildEndReason(chapters[chapters.length - 1], thread),
    source: "plot_threads",
    sourceThreadIds: [thread.id],
    confidence: emptyConfidence(),
    qualityFlags: [],
  };
}

function fillCoverageGaps(
  sourceId: string,
  existing: StoryWindow[],
  chapterChain: ChapterChainItem[],
  chapterCount: number,
  minSize: number,
  maxSize: number,
): StoryWindow[] {
  if (existing.length === 0) {
    return buildFallbackWindows(sourceId, chapterCount, chapterChain, minSize, maxSize);
  }

  const covered = new Set(existing.flatMap((window) => window.chapterNumbers));
  const missing = range(1, chapterCount).filter((chapter) => !covered.has(chapter));
  if (missing.length === 0) return existing;

  const gapWindows: StoryWindow[] = [];
  for (const group of contiguousGroups(missing)) {
    for (let index = 0; index < group.length; index += Math.max(minSize, Math.min(3, maxSize))) {
      const chunk = group.slice(index, index + Math.max(minSize, Math.min(3, maxSize)));
      gapWindows.push(buildFallbackWindow(sourceId, chunk, chapterChain, "fallback_window", "chapter_chain"));
    }
  }
  return [...existing, ...gapWindows].sort((a, b) => a.chapterNumbers[0] - b.chapterNumbers[0]);
}

function buildFallbackWindows(
  sourceId: string,
  chapterCount: number,
  chapterChain: ChapterChainItem[],
  minSize: number,
  maxSize: number,
): StoryWindow[] {
  const windows: StoryWindow[] = [];
  if (chapterCount <= 0) return windows;
  const openingEnd = Math.min(2, chapterCount);
  windows.push(buildFallbackWindow(sourceId, range(1, openingEnd), chapterChain, "opening_arc", "fallback"));
  const step = Math.max(minSize, Math.min(3, maxSize));
  for (let start = openingEnd + 1; start <= chapterCount; start += step) {
    windows.push(buildFallbackWindow(sourceId, range(start, Math.min(chapterCount, start + step - 1)), chapterChain, "fallback_window", "fallback"));
  }
  return windows;
}

function buildFallbackWindow(
  sourceId: string,
  chapterNumbers: number[],
  chapterChain: ChapterChainItem[],
  kind: StoryWindowKind,
  source: StoryWindowSource,
): StoryWindow {
  const chapters = chapterChainForNumbers(chapterChain, chapterNumbers);
  const title = kind === "opening_arc" ? "开局剧情窗口" : `第 ${formatChapterRange(chapterNumbers)} 章剧情窗口`;
  return {
    id: buildWindowId(sourceId, chapterNumbers, kind),
    chapterRange: formatChapterRange(chapterNumbers),
    chapterNumbers,
    kind,
    title,
    summary: joinChapterField(chapters, "mainEvent"),
    mainConflict: joinChapterField(chapters, "conflict"),
    involvedCharacters: [],
    startReason: buildStartReason(chapters[0]),
    endReason: buildEndReason(chapters[chapters.length - 1]),
    source,
    sourceThreadIds: [],
    confidence: emptyConfidence(),
    qualityFlags: [],
  };
}

function scoreStoryWindow(window: StoryWindow, minSize: number, maxSize: number): StoryWindow {
  const flags: string[] = [];
  const reasons: string[] = [];
  let score = 0;
  if (isContinuous(window.chapterNumbers)) {
    score += 0.20;
    reasons.push("continuous_chapter_numbers");
  } else {
    score -= 0.20;
    flags.push("non_contiguous_chapters");
  }
  if (window.chapterNumbers.length >= minSize && window.chapterNumbers.length <= maxSize) {
    score += 0.20;
    reasons.push("window_size_in_range");
  } else if (window.chapterNumbers.length > maxSize) {
    score -= 0.20;
    flags.push("too_long");
  } else {
    score -= 0.15;
    flags.push("too_short");
  }
  if (window.title.trim() && window.summary.trim() && window.mainConflict.trim()) {
    score += 0.25;
    reasons.push("has_title_summary_conflict");
  } else {
    score -= 0.20;
    flags.push("missing_summary_or_conflict");
  }
  if (window.involvedCharacters.length > 0) {
    score += 0.15;
    reasons.push("has_involved_characters");
  } else {
    score -= 0.10;
    flags.push("missing_involved_characters");
  }
  if (window.startReason.trim() && window.endReason.trim()) {
    score += 0.10;
    reasons.push("has_start_end_reason");
  }
  if (window.source === "plot_threads" || window.source === "chapter_chain") {
    score += 0.10;
    reasons.push(`source_${window.source}`);
  }

  return {
    ...window,
    confidence: {
      ruleScore: clampScore(score),
      llmScore: null,
      llmModel: null,
      reasons,
      llmReasons: null,
    },
    qualityFlags: Array.from(new Set(flags)),
  };
}

function buildMetrics(
  windows: StoryWindow[],
  chapterCount: number,
  minSize: number,
  maxSize: number,
): StoryWindowQualityMetrics {
  const chapterHits = new Map<number, number>();
  for (const window of windows) {
    for (const chapter of window.chapterNumbers) {
      if (chapter >= 1 && chapter <= chapterCount) chapterHits.set(chapter, (chapterHits.get(chapter) ?? 0) + 1);
    }
  }
  const covered = Array.from(chapterHits.keys()).sort((a, b) => a - b);
  const sourceCounts: Record<StoryWindowSource, number> = {
    plot_threads: 0,
    chapter_chain: 0,
    fallback: 0,
    llm_corrected: 0,
  };
  for (const window of windows) sourceCounts[window.source] += 1;
  return {
    chapterCount,
    windowCount: windows.length,
    coveredChapterCount: covered.length,
    coverageRate: chapterCount === 0 ? 0 : round2(covered.length / chapterCount),
    overlappingChapters: Array.from(chapterHits.entries()).filter(([, count]) => count > 1).map(([chapter]) => chapter),
    uncoveredChapters: range(1, chapterCount).filter((chapter) => !chapterHits.has(chapter)),
    averageWindowSize: average(windows.map((window) => window.chapterNumbers.length)),
    sourceCounts,
    lowConfidenceWindowCount: windows.filter((window) => window.confidence.ruleScore < LOW_CONFIDENCE_THRESHOLD).length,
    tooLongWindowCount: windows.filter((window) => window.chapterNumbers.length > maxSize).length,
    tooShortWindowCount: windows.filter((window) => window.chapterNumbers.length < minSize).length,
  };
}

function renderStoryWindowPreview(windows: StoryWindow[], summary: StoryWindowSummary): string {
  const lines = [
    `# 剧情窗口预览：${summary.sourceId}`,
    "",
    `- 窗口数：${summary.windowCount}`,
    `- 覆盖率：${summary.metrics.coverageRate}`,
    `- 平均窗口长度：${summary.metrics.averageWindowSize}`,
    "",
  ];
  for (const [index, window] of windows.entries()) {
    lines.push(`## window-${String(index + 1).padStart(3, "0")} 第 ${window.chapterRange} 章`);
    lines.push(`- ID：${window.id}`);
    lines.push(`- 类型：${window.kind}`);
    lines.push(`- 来源：${window.source}`);
    lines.push(`- 置信度：${window.confidence.ruleScore}`);
    lines.push(`- 标题：${window.title}`);
    lines.push(`- 概括：${window.summary}`);
    lines.push(`- 主冲突：${window.mainConflict}`);
    lines.push(`- 涉及人物：${window.involvedCharacters.join("、") || "待人工确认"}`);
    lines.push(`- 起点原因：${window.startReason}`);
    lines.push(`- 终点原因：${window.endReason}`);
    lines.push(`- 后续用途：可作为 character-cards 的输入窗口`);
    if (window.qualityFlags.length > 0) lines.push(`- 质量标记：${window.qualityFlags.join("、")}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function renderStoryWindowQualityReport(windows: StoryWindow[], summary: StoryWindowSummary): string {
  const lines = [
    `# 剧情窗口质量报告：${summary.sourceId}`,
    "",
    "## 指标",
    "",
    `- 总章节数：${summary.metrics.chapterCount}`,
    `- 窗口数量：${summary.metrics.windowCount}`,
    `- 覆盖章节数：${summary.metrics.coveredChapterCount}`,
    `- 覆盖率：${summary.metrics.coverageRate}`,
    `- 平均窗口长度：${summary.metrics.averageWindowSize}`,
    `- 重叠章节：${summary.metrics.overlappingChapters.join("、") || "无"}`,
    `- 未覆盖章节：${summary.metrics.uncoveredChapters.join("、") || "无"}`,
    `- 低置信窗口数：${summary.metrics.lowConfidenceWindowCount}`,
    `- 过长窗口数：${summary.metrics.tooLongWindowCount}`,
    `- 过短窗口数：${summary.metrics.tooShortWindowCount}`,
    "",
    "## 来源分布",
    "",
  ];
  for (const [source, count] of Object.entries(summary.metrics.sourceCounts)) {
    lines.push(`- ${source}: ${count}`);
  }
  lines.push("", "## 低置信窗口", "");
  for (const window of windows.filter((item) => item.confidence.ruleScore < LOW_CONFIDENCE_THRESHOLD)) {
    lines.push(`- ${window.chapterRange} / ${window.kind} / score=${window.confidence.ruleScore}: ${window.qualityFlags.join("、") || "需要人工确认"}`);
  }
  return `${lines.join("\n")}\n`;
}


const NON_CHARACTER_INVOLVED_NAMES = new Set([
  "时间",
  "过来",
  "过去",
  "回来",
  "下来",
  "下去",
  "点头",
  "摇头",
  "转头",
  "口气",
  "驸马",
]);

function normalizeInvolvedCharacters(names: string[]): string[] {
  const unique = Array.from(new Set(names.filter((name) => name.trim() && !NON_CHARACTER_INVOLVED_NAMES.has(name))));
  return unique.filter((name) =>
    !unique.some((other) => other !== name && other.length > name.length && other.includes(name)),
  );
}

function dedupeWindows(windows: StoryWindow[]): StoryWindow[] {
  const priority: Record<StoryWindowSource, number> = {
    plot_threads: 4,
    chapter_chain: 3,
    fallback: 2,
    llm_corrected: 5,
  };
  const byRange = new Map<string, StoryWindow>();
  for (const window of windows) {
    const existing = byRange.get(window.chapterRange);
    if (!existing || priority[window.source] > priority[existing.source]) byRange.set(window.chapterRange, window);
  }
  return Array.from(byRange.values());
}

function toWindowKind(kind: PlotThreadMaterial["kind"], chapterNumbers: number[]): StoryWindowKind {
  if (chapterNumbers[0] === 1) return "opening_arc";
  if (kind === "mini_arc") return "mini_arc";
  if (kind === "subplot") return "subplot";
  if (kind === "phase") return "phase_arc";
  return "fallback_window";
}

function chapterChainForNumbers(chapterChain: ChapterChainItem[], chapterNumbers: number[]): ChapterChainItem[] {
  const byNumber = new Map(chapterChain.map((chapter) => [chapter.chapterNumber, chapter]));
  return chapterNumbers.map((number) => byNumber.get(number)).filter((chapter): chapter is ChapterChainItem => Boolean(chapter));
}

function buildStartReason(chapter: ChapterChainItem | undefined, thread?: PlotThreadMaterial): string {
  if (!chapter) return thread ? `从 ${thread.title} 的首章开始。` : "窗口起点需要人工确认。";
  return `第 ${chapter.chapterNumber} 章：${chapter.function || chapter.mainEvent}`;
}

function buildEndReason(chapter: ChapterChainItem | undefined, thread?: PlotThreadMaterial): string {
  if (!chapter) return thread ? `到 ${thread.title} 的末章结束。` : "窗口终点需要人工确认。";
  return `第 ${chapter.chapterNumber} 章：${chapter.hookOut || chapter.relationshipShift || chapter.mainEvent}`;
}

function joinChapterField(chapters: ChapterChainItem[], field: "mainEvent" | "conflict"): string {
  return chapters.map((chapter) => chapter[field]).filter(Boolean).join(" ");
}

function normalizeChapterNumbers(numbers: number[]): number[] {
  return Array.from(new Set(numbers.filter((number) => Number.isInteger(number) && number > 0))).sort((a, b) => a - b);
}

function contiguousGroups(numbers: number[]): number[][] {
  const groups: number[][] = [];
  for (const number of normalizeChapterNumbers(numbers)) {
    const lastGroup = groups[groups.length - 1];
    if (!lastGroup || lastGroup[lastGroup.length - 1] + 1 !== number) groups.push([number]);
    else lastGroup.push(number);
  }
  return groups;
}

function isContinuous(numbers: number[]): boolean {
  return numbers.every((number, index) => index === 0 || number === numbers[index - 1] + 1);
}

function inferChapterCount(chapterChain: ChapterChainItem[], plotThreads: PlotThreadMaterial[]): number {
  return Math.max(
    0,
    ...chapterChain.map((chapter) => chapter.chapterNumber),
    ...plotThreads.flatMap((thread) => thread.chapterNumbers),
  );
}

function buildWindowId(sourceId: string, chapterNumbers: number[], kind: StoryWindowKind): string {
  return `${sourceId}:window:${formatChapterRange(chapterNumbers)}:${kind}`;
}

function formatChapterRange(chapterNumbers: number[]): string {
  if (chapterNumbers.length === 0) return "0-0";
  return `${chapterNumbers[0]}-${chapterNumbers[chapterNumbers.length - 1]}`;
}

function range(start: number, end: number): number[] {
  if (end < start) return [];
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function emptyConfidence() {
  return {
    ruleScore: 0,
    llmScore: null,
    llmModel: null,
    reasons: [],
    llmReasons: null,
  };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return round2(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, round2(value)));
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
}
