import { endpoints, type ModelEndpoint } from "../models.js";
import { requestJsonText } from "./json-llm.js";
import type { FanficCanonCard, FanficIdeaCard } from "./idea-parser.js";

export interface FanficPlanScene {
  order: number;
  title: string;
  purpose: string;
  wordBudget: number;
  beats: string[];
  requiredScenes: string[];
  canonConstraints: string[];
  emotionalTurn: string;
}

export interface FanficRequiredSceneCoverage {
  requiredScene: string;
  sceneTitle: string;
}

export interface FanficShortPlan {
  title: string;
  logline: string;
  premise: string;
  emotionalArc: { from: string; to: string; turningPoint: string };
  scenes: FanficPlanScene[];
  requiredSceneCoverage: FanficRequiredSceneCoverage[];
  avoidChecks: string[];
  endingStrategy: string;
  writerNotes: string[];
}

export interface FanficShortPlannerOptions {
  endpoint?: ModelEndpoint;
}

export async function planFanficShortStory(
  idea: FanficIdeaCard,
  canon: FanficCanonCard,
  options: FanficShortPlannerOptions = {},
): Promise<FanficShortPlan> {
  const endpoint = options.endpoint ?? endpoints.fanficPlan;
  const rawText = await requestJsonText(endpoint, {
    maxTokens: 8000,
    system: buildSystemPrompt(),
    content: buildUserPrompt(idea, canon),
  });

  const plan = normalizePlan(parseJsonObject(rawText));
  validatePlanAgainstIdea(plan, idea);
  return plan;
}

function buildSystemPrompt(): string {
  return [
    "你是同人短篇小说 planner，只生成可执行短篇计划。",
    "不要写正文，不要审稿，不要决定文件路径或流程状态。",
    "计划必须是 4-5 个 scenes，每个 scene 至少包含 1 个 beat。",
    "必须输出严格 JSON，不要额外解释。",
  ].join("\n");
}

function buildUserPrompt(idea: FanficIdeaCard, canon: FanficCanonCard): string {
  return [
    "请基于同人故事卡和 canon 约束生成短篇计划 JSON。",
    "",
    "## 故事卡",
    JSON.stringify(idea, null, 2),
    "",
    "## Canon 约束",
    JSON.stringify(canon, null, 2),
    "",
    "输出 JSON schema:",
    "{",
    "  \"title\": \"标题建议\",",
    "  \"logline\": \"一句话故事\",",
    "  \"premise\": \"核心前提\",",
    "  \"emotionalArc\": { \"from\": \"起点\", \"to\": \"终点\", \"turningPoint\": \"转折\" },",
    "  \"scenes\": [",
    "    {",
    "      \"order\": 1,",
    "      \"title\": \"大场景名\",",
    "      \"purpose\": \"此场景作用\",",
    "      \"wordBudget\": 1000,",
    "      \"beats\": [\"2-3 个可写作小节拍\"],",
    "      \"requiredScenes\": [\"覆盖的必须场面，可空数组\"],",
    "      \"canonConstraints\": [\"本场景要遵守的原作约束\"],",
    "      \"emotionalTurn\": \"情绪变化\"",
    "    }",
    "  ],",
    "  \"requiredSceneCoverage\": [{ \"requiredScene\": \"必须场面\", \"sceneTitle\": \"对应 scene\" }],",
    "  \"avoidChecks\": [\"雷点/禁区规避检查\"],",
    "  \"endingStrategy\": \"结尾策略\",",
    "  \"writerNotes\": [\"写作注意事项\"]",
    "}",
  ].join("\n");
}

function parseJsonObject(rawText: string): unknown {
  const fence = String.fromCharCode(96, 96, 96);
  const fencedMatch = rawText.match(/~~~(?:json)?\s*([\s\S]*?)~~~/) ??
    rawText.match(new RegExp(fence + "(?:json)?\\s*([\\s\\S]*?)" + fence));
  const candidate = fencedMatch?.[1] ?? rawText.match(/(\{[\s\S]*\})/)?.[1] ?? rawText;
  try {
    return JSON.parse(candidate);
  } catch {
    throw new Error("Invalid fanfic short plan: LLM output is not valid JSON");
  }
}

function normalizePlan(value: unknown): FanficShortPlan {
  if (!isRecord(value)) throw new Error("Invalid fanfic short plan: expected object");
  assertString(value.title, "title");
  assertString(value.logline, "logline");
  assertString(value.premise, "premise");
  if (!isRecord(value.emotionalArc)) throw new Error("Invalid fanfic short plan: emotionalArc must be object");
  assertString(value.emotionalArc.from, "emotionalArc.from");
  assertString(value.emotionalArc.to, "emotionalArc.to");
  assertString(value.emotionalArc.turningPoint, "emotionalArc.turningPoint");
  if (!Array.isArray(value.scenes)) throw new Error("Invalid fanfic short plan: scenes must be array");
  if (!Array.isArray(value.requiredSceneCoverage)) throw new Error("Invalid fanfic short plan: requiredSceneCoverage must be array");
  assertStringArray(value.avoidChecks, "avoidChecks");
  assertString(value.endingStrategy, "endingStrategy");
  assertStringArray(value.writerNotes, "writerNotes");
  const scenes = value.scenes.map(normalizeScene);
  const requiredSceneCoverage = value.requiredSceneCoverage.map(normalizeCoverage);
  return {
    title: value.title,
    logline: value.logline,
    premise: value.premise,
    emotionalArc: {
      from: value.emotionalArc.from,
      to: value.emotionalArc.to,
      turningPoint: value.emotionalArc.turningPoint,
    },
    scenes,
    requiredSceneCoverage,
    avoidChecks: value.avoidChecks,
    endingStrategy: value.endingStrategy,
    writerNotes: value.writerNotes,
  };
}

function normalizeScene(value: unknown): FanficPlanScene {
  if (!isRecord(value)) throw new Error("Invalid fanfic short plan: scene must be object");
  assertPositiveNumber(value.order, "scene.order");
  assertString(value.title, "scene.title");
  assertString(value.purpose, "scene.purpose");
  assertPositiveNumber(value.wordBudget, "scene.wordBudget");
  assertStringArray(value.beats, "scene.beats");
  assertStringArray(value.requiredScenes, "scene.requiredScenes");
  assertStringArray(value.canonConstraints, "scene.canonConstraints");
  assertString(value.emotionalTurn, "scene.emotionalTurn");
  return {
    order: value.order,
    title: value.title,
    purpose: value.purpose,
    wordBudget: value.wordBudget,
    beats: value.beats,
    requiredScenes: value.requiredScenes,
    canonConstraints: value.canonConstraints,
    emotionalTurn: value.emotionalTurn,
  };
}

function normalizeCoverage(value: unknown): FanficRequiredSceneCoverage {
  if (!isRecord(value)) throw new Error("Invalid fanfic short plan: coverage must be object");
  assertString(value.requiredScene, "coverage.requiredScene");
  assertString(value.sceneTitle, "coverage.sceneTitle");
  return { requiredScene: value.requiredScene, sceneTitle: value.sceneTitle };
}

function validatePlanAgainstIdea(plan: FanficShortPlan, idea: FanficIdeaCard): void {
  if (plan.scenes.length < 4 || plan.scenes.length > 5) {
    throw new Error("Invalid fanfic short plan: scenes must contain 4-5 items");
  }
  for (const scene of plan.scenes) {
    if (scene.beats.length < 1) {
      throw new Error("Invalid fanfic short plan: each scene must contain at least 1 beat");
    }
  }
  const coveredRequiredScenes = new Set(plan.requiredSceneCoverage.map((item) => item.requiredScene));
  for (const requiredScene of idea.requiredScenes) {
    if (!coveredRequiredScenes.has(requiredScene)) {
      throw new Error("Invalid fanfic short plan: required scene not covered: " + requiredScene);
    }
  }
  for (const dislike of idea.dislikes) {
    if (!hasTextSignal(plan.avoidChecks.join(" "), dislike)) {
      plan.avoidChecks.push("避免：" + dislike);
    }
  }
}

function hasTextSignal(text: string, target: string): boolean {
  if (text.includes(target)) return true;
  const signals = extractTextSignals(target);
  if (signals.length === 0) return false;
  const matched = signals.filter((signal) => text.includes(signal));
  return matched.length >= Math.min(2, signals.length);
}

function extractTextSignals(target: string): string[] {
  const text = target.replace(/[\s，。！？、；：“”‘’（）()《》.!,?:;]+/g, "");
  const signals = new Set<string>();
  for (let index = 0; index < text.length - 1; index += 1) {
    const signal = text.slice(index, index + 2);
    if (!/[的了在里把向她他它是和与不]/.test(signal)) {
      signals.add(signal);
    }
  }
  return [...signals];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Invalid fanfic short plan: " + field + " must be a non-empty string");
  }
}

function assertStringArray(value: unknown, field: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new Error("Invalid fanfic short plan: " + field + " must be a string array");
  }
}

function assertPositiveNumber(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error("Invalid fanfic short plan: " + field + " must be a positive number");
  }
}
