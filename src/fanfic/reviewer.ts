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
    maxTokens: 1800,
    system: buildSystemPrompt(),
    content: buildUserPrompt(context, draft),
  });
  return normalizeReview(parseJsonObject(rawText));
}

function buildSystemPrompt(): string {
  return [
    "你是同人短篇审稿人，只输出结构化 review JSON。",
    "不要改写正文，不要决定流程状态。",
    "重点检查 canon 贴合、required scenes 覆盖、雷点规避、CP 张力、节奏和文笔。",
  ].join("\n");
}

function buildUserPrompt(context: FanficWriterContext, draft: string): string {
  return [
    "请审阅下面的同人短篇草稿，并严格输出 JSON。",
    "",
    "## Writer Context",
    JSON.stringify(context, null, 2),
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
