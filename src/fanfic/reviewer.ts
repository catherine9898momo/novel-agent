import { endpoints, type ModelEndpoint } from "../models.js";
import { requestJsonText } from "./json-llm.js";
import type { FanficWriterContext } from "./writer-context.js";

export type FanficReviewVerdict = "ready" | "needs_rewrite";
export type FanficReviewSeverity = "minor" | "major" | "critical";

export interface FanficReviewIssue {
  severity: FanficReviewSeverity;
  area: string;
  message: string;
  suggestion: string;
}

export interface FanficReview {
  score: number;
  verdict: FanficReviewVerdict;
  dimensions: {
    canonFit: number;
    requiredSceneCoverage: number;
    avoidListSafety: number;
    proseQuality: number;
    relationshipTension: number;
    pacing: number;
  };
  passedChecks: string[];
  issues: FanficReviewIssue[];
  rewriteBrief: string[];
}

export interface FanficReviewOptions {
  endpoint?: ModelEndpoint;
}

export async function reviewFanficDraft(
  context: FanficWriterContext,
  draft: string,
  options: FanficReviewOptions = {},
): Promise<FanficReview> {
  const endpoint = options.endpoint ?? endpoints.fanficReview;
  const rawText = await requestJsonText(endpoint, {
    maxTokens: 2600,
    system: buildSystemPrompt(),
    content: buildUserPrompt(context, draft),
  });
  const parsed = await parseReviewJsonWithRepair(rawText, endpoint);
  return normalizeReview(parsed);
}

function buildSystemPrompt(): string {
  return [
    "你是同人短篇审稿人，只输出结构化 review JSON。",
    "不要改写正文，不要决定流程状态。",
    "重点检查 canon 贴合、required scenes 覆盖、雷点规避、CP 张力、节奏和文笔。",
    "同时审查 plan.scenes[].narrativeStrategy 的执行情况：是否解释过度、物件或动作缺失、表层信号不足、留白被作者总结破坏。",
  ].join("\n");
}

function buildUserPrompt(context: FanficWriterContext, draft: string): string {
  return [
    "请审阅下面的同人短篇草稿，并严格输出 JSON。",
    "若草稿违反 narrativeStrategy，请在 issues 中放入 prose_quality 或 relationship_tension 问题，并在 rewriteBrief 中给出可执行修复：删去解释、补动作或物件、保留留白、压低金句式结尾。",
    "",
    "## Writer Context",
    JSON.stringify(buildReviewContext(context), null, 2),
    "",
    "## Draft",
    draft,
    "",
    "JSON schema:",
    "{",
    "  \"score\": 1,",
    "  \"verdict\": \"ready 或 needs_rewrite\",",
    "  \"dimensions\": { \"canonFit\": 1, \"requiredSceneCoverage\": 1, \"avoidListSafety\": 1, \"proseQuality\": 1, \"relationshipTension\": 1, \"pacing\": 1 },",
    "  \"passedChecks\": [\"通过项\"],",
    "  \"issues\": [{ \"severity\": \"minor/major/critical\", \"area\": \"问题领域\", \"message\": \"问题\", \"suggestion\": \"修改建议\" }],",
    "  \"rewriteBrief\": [\"改写指令\"]",
    "}",
  ].join("\n");
}


async function parseReviewJsonWithRepair(rawText: string, endpoint: ModelEndpoint): Promise<unknown> {
  try {
    return parseJsonObject(rawText);
  } catch (error) {
    if (!(error instanceof Error) || !/not valid JSON/i.test(error.message)) throw error;
  }

  const repairedText = await requestJsonText(endpoint, {
    maxTokens: 2200,
    system: buildRepairSystemPrompt(),
    content: buildRepairPrompt(rawText),
  });
  return parseJsonObject(repairedText);
}

function buildReviewContext(context: FanficWriterContext): unknown {
  return {
    idea: {
      source: context.idea.source,
      relationship: context.idea.relationship,
      timeline: context.idea.timeline,
      divergence: context.idea.divergence,
      tropes: context.idea.tropes,
      dislikes: context.idea.dislikes,
      rating: context.idea.rating,
      ending: context.idea.ending,
      requiredScenes: context.idea.requiredScenes,
      summary: context.idea.summary,
    },
    canon: {
      constraints: context.canon.constraints,
      characterNotes: context.canon.characterNotes,
      timelineNotes: context.canon.timelineNotes,
      risks: context.canon.risks,
    },
    plan: {
      title: context.plan.title,
      logline: context.plan.logline,
      premise: context.plan.premise,
      emotionalArc: context.plan.emotionalArc,
      scenes: context.plan.scenes.map((scene) => ({
        order: scene.order,
        title: scene.title,
        purpose: scene.purpose,
        beats: scene.beats,
        requiredScenes: scene.requiredScenes,
        canonConstraints: scene.canonConstraints,
        emotionalTurn: scene.emotionalTurn,
        narrativeStrategy: scene.narrativeStrategy,
      })),
      requiredSceneCoverage: context.plan.requiredSceneCoverage,
      avoidChecks: context.plan.avoidChecks,
      endingStrategy: context.plan.endingStrategy,
    },
    requiredScenes: context.requiredScenes,
    avoidChecks: context.avoidChecks,
  };
}

function buildRepairSystemPrompt(): string {
  return [
    "你是同人短篇 review JSON 修复器。",
    "只把原始审稿输出转换为合法 JSON，不新增正文，不解释。",
    "必须输出一个 JSON object，且字段必须符合 schema。",
  ].join("\n");
}

function buildRepairPrompt(rawText: string): string {
  return [
    "请把下面的原始非 JSON 输出转换为严格 JSON。",
    "如果原文没有某个字段，请根据原文可判断的信息给出保守值；无法判断时使用 needs_rewrite 和较低分。",
    "JSON schema:",
    "{",
    "  \"score\": 1,",
    "  \"verdict\": \"ready 或 needs_rewrite\",",
    "  \"dimensions\": { \"canonFit\": 1, \"requiredSceneCoverage\": 1, \"avoidListSafety\": 1, \"proseQuality\": 1, \"relationshipTension\": 1, \"pacing\": 1 },",
    "  \"passedChecks\": [\"通过项\"],",
    "  \"issues\": [{ \"severity\": \"minor/major/critical\", \"area\": \"问题领域\", \"message\": \"问题\", \"suggestion\": \"修改建议\" }],",
    "  \"rewriteBrief\": [\"改写指令\"]",
    "}",
    "",
    "## 原始非 JSON 输出",
    truncateForRepair(rawText),
  ].join("\n");
}

function truncateForRepair(text: string): string {
  return text.length > 12000 ? text.slice(0, 12000) : text;
}

function parseJsonObject(rawText: string): unknown {
  const fence = String.fromCharCode(96, 96, 96);
  const fencedMatch = rawText.match(/~~~(?:json)?\s*([\s\S]*?)~~~/) ??
    rawText.match(new RegExp(fence + "(?:json)?\\s*([\\s\\S]*?)" + fence));
  const candidate = fencedMatch?.[1] ?? rawText.match(/(\{[\s\S]*\})/)?.[1] ?? rawText;
  try { return JSON.parse(candidate); } catch { throw new Error("Invalid fanfic review: LLM output is not valid JSON"); }
}

function normalizeReview(value: unknown): FanficReview {
  if (!isRecord(value)) throw new Error("Invalid fanfic review: expected object");
  assertNumber(value.score, "score");
  if (value.verdict !== "ready" && value.verdict !== "needs_rewrite") throw new Error("Invalid fanfic review: verdict invalid");
  if (!isRecord(value.dimensions)) throw new Error("Invalid fanfic review: dimensions must be object");
  const dimensions = value.dimensions as Record<string, unknown>;
  const normalizedDimensions = {
    canonFit: readNumber(dimensions.canonFit, "dimensions.canonFit"),
    requiredSceneCoverage: readNumber(dimensions.requiredSceneCoverage, "dimensions.requiredSceneCoverage"),
    avoidListSafety: readNumber(dimensions.avoidListSafety, "dimensions.avoidListSafety"),
    proseQuality: readNumber(dimensions.proseQuality, "dimensions.proseQuality"),
    relationshipTension: readNumber(dimensions.relationshipTension, "dimensions.relationshipTension"),
    pacing: readNumber(dimensions.pacing, "dimensions.pacing"),
  };
  assertStringArray(value.passedChecks, "passedChecks");
  if (!Array.isArray(value.issues)) throw new Error("Invalid fanfic review: issues must be array");
  assertStringArray(value.rewriteBrief, "rewriteBrief");
  return {
    score: value.score,
    verdict: value.verdict,
    dimensions: {
      canonFit: normalizedDimensions.canonFit,
      requiredSceneCoverage: normalizedDimensions.requiredSceneCoverage,
      avoidListSafety: normalizedDimensions.avoidListSafety,
      proseQuality: normalizedDimensions.proseQuality,
      relationshipTension: normalizedDimensions.relationshipTension,
      pacing: normalizedDimensions.pacing,
    },
    passedChecks: value.passedChecks,
    issues: value.issues.map(normalizeIssue),
    rewriteBrief: value.rewriteBrief,
  };
}

function normalizeIssue(value: unknown): FanficReviewIssue {
  if (!isRecord(value)) throw new Error("Invalid fanfic review: issue must be object");
  if (value.severity !== "minor" && value.severity !== "major" && value.severity !== "critical") throw new Error("Invalid fanfic review: issue severity invalid");
  assertString(value.area, "issue.area");
  assertString(value.message, "issue.message");
  assertString(value.suggestion, "issue.suggestion");
  return { severity: value.severity, area: value.area, message: value.message, suggestion: value.suggestion };
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function assertString(value: unknown, field: string): asserts value is string { if (typeof value !== "string" || value.trim() === "") throw new Error("Invalid fanfic review: " + field + " must be string"); }
function assertStringArray(value: unknown, field: string): asserts value is string[] { if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) throw new Error("Invalid fanfic review: " + field + " must be string array"); }
function readNumber(value: unknown, field: string): number { if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Invalid fanfic review: " + field + " must be number"); return value; }
function assertNumber(value: unknown, field: string): asserts value is number { if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Invalid fanfic review: " + field + " must be number"); }
