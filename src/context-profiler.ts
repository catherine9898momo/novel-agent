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
  estimatedInputTokens: number;
}

export interface ContextTaskProfile {
  task: "review" | "analyze" | "audit";
  description: string;
  files: ContextFileProfile[];
  promptOverheadChars: number;
  totalChars: number;
  estimatedInputTokens: number;
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

/**
 * 粗略估算一段已知输入文本会占用多少 input tokens。
 *
 * 当前规则：
 * - 中文字符按约 1 char = 1 token 估算；
 * - 非中文非空白字符按约 4 chars = 1 token 估算；
 * - 空白字符不计入估算。
 *
 * 这个函数不是 tokenizer 的精确替代，而是 LLM 调用前的输入预算预检工具。
 *
 * @param text 待估算的 prompt 片段或文件内容
 * @returns 估算 input token 数，向上取整
 */
export function estimateInputTokens(text: string): number {
  const cjkChars = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const nonWhitespace = text.replace(/\s/g, "").length;
  const nonCjkChars = Math.max(0, nonWhitespace - cjkChars);
  return Math.ceil(cjkChars + nonCjkChars / 4);
}

/**
 * 根据文件名判断文件在上下文系统中的类别。
 *
 * 分类用于后续组装不同任务的 context profile：
 * - planning: 大纲、人物、关系、章节元数据；
 * - state: 故事摘要、伏笔、状态、todo、角色声音；
 * - chapter: 已写章节正文；
 * - other: 未被当前 profiler 识别的文件。
 *
 * @param file 小说目录下的文件名，不包含目录路径
 * @returns 文件类别，用于统计和任务级 context 拆分
 */
function classifyFile(file: string): ContextFileProfile["kind"] {
  if (/^\d{3}-.*\.md$/.test(file)) return "chapter";
  if (PLANNING_FILES.includes(file)) return "planning";
  if (STATE_FILES.includes(file)) return "state";
  if (file.startsWith("_voice")) return "state";
  return "other";
}

/**
 * 读取并统计一个已存在的小说文件。
 *
 * 如果目标路径不存在或不是普通文件，返回 null，调用方可以安全过滤。
 * 如果文件存在，则统计字符数、估算 input token 数，并标注文件类别。
 *
 * @param rootDir 小说目录路径，例如 novels/烟雨长安
 * @param file rootDir 下的文件名
 * @returns 文件 profile；文件不存在或不是普通文件时返回 null
 */
async function profileExistingFile(rootDir: string, file: string): Promise<ContextFileProfile | null> {
  const fullPath = path.join(rootDir, file);
  const stat = await fs.stat(fullPath).catch(() => null);
  if (!stat?.isFile()) return null;

  const content = await fs.readFile(fullPath, "utf-8");
  return {
    file,
    kind: classifyFile(file),
    chars: content.length,
    estimatedInputTokens: estimateInputTokens(content),
  };
}

/**
 * 汇总多个文件的字符数。
 *
 * @param files 已统计过的文件 profile 列表
 * @returns 所有文件 chars 字段的总和
 */
function sumChars(files: ContextFileProfile[]): number {
  return files.reduce((sum, file) => sum + file.chars, 0);
}

/**
 * 根据估算 token 数给一次任务级 prompt 标记风险等级。
 *
 * 风险等级用于提醒是否需要拆分、压缩或改用 Context Pack：
 * - ok: 当前规模较安全；
 * - watch: 接近需要关注的区间；
 * - high: 已经应该进行分层上下文或压缩。
 *
 * @param tokens 某个任务预计输入 LLM 的 token 数
 * @returns context 风险等级
 */
function riskForTokens(tokens: number): ContextTaskProfile["risk"] {
  if (tokens >= 50000) return "high";
  if (tokens >= 25000) return "watch";
  return "ok";
}

/**
 * 根据任务类型和风险等级生成下一步建议。
 *
 * 这个函数把“数字观测”翻译成工程动作：
 * review 边界通常较小；analyze/audit 一旦增长，需要进入分层 Context Pack。
 *
 * @param task 被评估的任务类型：review、analyze 或 audit
 * @param risk 该任务当前的 context 风险等级
 * @returns 面向 CLI 输出的人类可读建议
 */
function recommendationFor(task: ContextTaskProfile["task"], risk: ContextTaskProfile["risk"]): string {
  if (task === "review") return "review 只注入单章 + 章节元数据 + 风格指南，当前边界正确。";
  if (risk === "high") return "必须改成分层 Context Pack：早期章节摘要化，最近章节保留全文，并把伏笔/人物状态结构化。";
  if (risk === "watch") return "开始接近需要压缩的区间，下一步应拆 Writer/Review/Audit 的专用 Context Pack。";
  return "当前规模可运行，但 analyze/audit 的全文注入会随章节线性增长，需要持续监控。";
}

/**
 * 构造某个任务的 context profile。
 *
 * 输入是一组会进入该任务 prompt 的文件 profile，以及手写 prompt 模板的大致字符开销。
 * 输出包含总字符数、估算 token、风险等级和建议。
 *
 * @param task 任务类型：review、analyze 或 audit
 * @param description 当前任务上下文来源的说明
 * @param files 会被注入该任务 prompt 的文件 profile
 * @param promptOverheadChars prompt 模板、说明文字、JSON 格式要求等非文件内容的估算字符数
 * @returns 完整的任务级 context profile
 */
function buildTaskProfile(
  task: ContextTaskProfile["task"],
  description: string,
  files: ContextFileProfile[],
  promptOverheadChars: number,
): ContextTaskProfile {
  const totalChars = sumChars(files) + promptOverheadChars;
  const estimatedInputTokens = files.reduce((sum, file) => sum + file.estimatedInputTokens, 0) + estimateInputTokens("x".repeat(promptOverheadChars));
  const risk = riskForTokens(estimatedInputTokens);
  return {
    task,
    description,
    files,
    promptOverheadChars,
    totalChars,
    estimatedInputTokens,
    risk,
    recommendation: recommendationFor(task, risk),
  };
}

/**
 * 统计一部小说当前的上下文规模，并按任务拆分 review/analyze/audit 的输入规模。
 *
 * 这个函数是 context profiler 的核心入口：
 * - 扫描小说目录下的规划文件、状态文件和章节文件；
 * - 估算每个文件的字符数和 token 数；
 * - 按当前实现方式模拟 review/analyze/audit 会读取哪些内容；
 * - 输出任务级风险等级和建议。
 *
 * @param novelName 小说名，用于报告展示
 * @param novelDir 小说目录路径，例如 novels/烟雨长安
 * @param styleGuide 当前风格指南文本；默认空字符串
 * @returns 小说级 context profile，包含文件统计和任务级统计
 */
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
    estimatedInputTokens: estimateInputTokens(styleGuide),
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
    files: [...profiles, styleProfile].sort((a, b) => b.estimatedInputTokens - a.estimatedInputTokens),
    tasks,
  };
}

/**
 * 将数字格式化为带千分位分隔符的字符串。
 *
 * @param n 待格式化的数字
 * @returns 英文 locale 的数字字符串，例如 19827 -> "19,827"
 */
function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * 将内部风险枚举转换成 CLI 输出标签。
 *
 * @param risk context 风险等级
 * @returns 大写展示标签：OK、WATCH 或 HIGH
 */
function riskLabel(risk: ContextTaskProfile["risk"]): string {
  if (risk === "high") return "HIGH";
  if (risk === "watch") return "WATCH";
  return "OK";
}

/**
 * 把 NovelContextProfile 格式化成 CLI 可读报告。
 *
 * 输出内容包括：
 * - 小说章节数、章节正文规模、规划/设定规模；
 * - 文件规模 Top 8；
 * - review/analyze/audit 的任务级 context 估算；
 * - 对应的 L3 Agent 工程概念说明。
 *
 * @param profile profileNovelContext 生成的小说级上下文统计结果
 * @returns 可直接 console.log 的多行文本报告
 */
export function formatContextProfile(profile: NovelContextProfile): string {
  const lines: string[] = [];
  lines.push(`\n── Context Profiler: ${profile.novelName} ──────────────────────`);
  lines.push(`章节数: ${profile.chapterCount}`);
  lines.push(`章节正文: ${formatNumber(profile.totalChapterChars)} chars`);
  lines.push(`规划/设定: ${formatNumber(profile.totalPlanningChars)} chars`);

  lines.push("\n文件规模 Top 8:");
  for (const file of profile.files.slice(0, 8)) {
    lines.push(`  ${file.file.padEnd(32)} ${formatNumber(file.chars).padStart(8)} chars  ~${formatNumber(file.estimatedInputTokens).padStart(7)} input tok  ${file.kind}`);
  }

  lines.push("\n任务级 Context 估算:");
  for (const task of profile.tasks) {
    lines.push(`  ${task.task.padEnd(7)} [${riskLabel(task.risk)}] ${formatNumber(task.totalChars).padStart(8)} chars  ~${formatNumber(task.estimatedInputTokens).padStart(7)} input tok`);
    lines.push(`          ${task.description}`);
    lines.push(`          ${task.recommendation}`);
  }

  lines.push("\nL3 概念落点:");
  lines.push("  Context Engineering = 不同任务只拿完成任务所需的最小上下文，而不是全文塞入。");
  lines.push("  Production Control = 在昂贵 LLM 调用前做预算预检，让流程可观测、可拒绝、可演进。");
  lines.push("");
  return lines.join("\n");
}
