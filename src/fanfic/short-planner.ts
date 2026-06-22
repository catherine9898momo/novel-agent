import { endpoints, type ModelEndpoint } from "../models.js";
import { requestJsonText } from "./json-llm.js";
import type { FanficCanonCard, FanficIdeaCard } from "./idea-parser.js";

export interface FanficNarrativeStrategy {
  purpose: string;
  viewpointDistance: string;
  emotionCarriers: string[];
  surfaceSignals: string[];
  withheldInterior: string[];
  antiClicheMoves: string[];
  closingMove: string;
}

export interface FanficPlanScene {
  order: number;
  title: string;
  purpose: string;
  wordBudget: number;
  beats: string[];
  requiredScenes: string[];
  canonConstraints: string[];
  emotionalTurn: string;
  narrativeStrategy: FanficNarrativeStrategy;
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
    "每个 scene 必须包含 narrativeStrategy，用来决定本场情绪如何被看见，而不是被作者解释。",
    "narrativeStrategy 不是风格切换，而是短篇默认质量基线；不同场景可以使用贴身、半贴身、旁观、全知克制等不同叙事距离。",
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
    "      \"emotionalTurn\": \"情绪变化\",",
    "      \"narrativeStrategy\": {",
    "        \"purpose\": \"本场阅读效果：读者应如何感到情绪，而不是作者直接说明\",",
    "        \"viewpointDistance\": \"贴身 / 半贴身 / 旁观 / 全知克制；按场景需要选择，不要全部旁观\",",
    "        \"emotionCarriers\": [\"承接情绪的物件、动作、环境声或闲话\"],",
    "        \"surfaceSignals\": [\"可被看见/听见的表层信号，如停顿、避开视线、衣袖、断箭、酒碗\"],",
    "        \"withheldInterior\": [\"本场不要解释的内心信息或关系结论\"],",
    "        \"antiClicheMoves\": [\"避免直白心理、作者总结、金句煽情、俗套比喻的具体约束\"],",
    "        \"closingMove\": \"本场结尾如何克制收束，如日常一句话、物件回落、动作停住\"",
    "      }",
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
  const baseScene = {
    order: value.order,
    title: value.title,
    purpose: value.purpose,
    wordBudget: value.wordBudget,
    beats: value.beats,
    requiredScenes: value.requiredScenes,
    canonConstraints: value.canonConstraints,
    emotionalTurn: value.emotionalTurn,
  };
  const narrativeStrategy = normalizeNarrativeStrategy(value.narrativeStrategy, baseScene);
  return {
    order: value.order,
    title: value.title,
    purpose: value.purpose,
    wordBudget: value.wordBudget,
    beats: value.beats,
    requiredScenes: value.requiredScenes,
    canonConstraints: value.canonConstraints,
    emotionalTurn: value.emotionalTurn,
    narrativeStrategy,
  };
}

function normalizeNarrativeStrategy(
  value: unknown,
  scene: Omit<FanficPlanScene, "narrativeStrategy">,
): FanficNarrativeStrategy {
  const fallback = buildDefaultNarrativeStrategy(scene);
  if (!isRecord(value)) return fallback;

  return {
    purpose: readOptionalString(value.purpose) ?? fallback.purpose,
    viewpointDistance: readOptionalString(value.viewpointDistance) ?? fallback.viewpointDistance,
    emotionCarriers: readOptionalStringArray(value.emotionCarriers) ?? fallback.emotionCarriers,
    surfaceSignals: readOptionalStringArray(value.surfaceSignals) ?? fallback.surfaceSignals,
    withheldInterior: readOptionalStringArray(value.withheldInterior) ?? fallback.withheldInterior,
    antiClicheMoves: readOptionalStringArray(value.antiClicheMoves) ?? fallback.antiClicheMoves,
    closingMove: readOptionalString(value.closingMove) ?? fallback.closingMove,
  };
}

function buildDefaultNarrativeStrategy(scene: Omit<FanficPlanScene, "narrativeStrategy">): FanficNarrativeStrategy {
  const carriers = [...scene.requiredScenes, ...scene.beats.slice(0, 2)].filter(Boolean);
  return {
    purpose: `让「${scene.title}」的${scene.emotionalTurn}通过可见细节被读者看见，而不是由作者解释。`,
    viewpointDistance: "半贴身",
    emotionCarriers: carriers.length > 0 ? carriers : [scene.title],
    surfaceSignals: ["停顿", "视线", "手上动作", "环境声"],
    withheldInterior: ["不解释真正心意", "不替读者总结关系"],
    antiClicheMoves: ["避免直白心理", "避免金句式煽情", "避免俗套比喻"],
    closingMove: "用动作、物件或日常一句话克制收束。",
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

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function readOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
  return items.length > 0 ? items : undefined;
}

function assertPositiveNumber(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error("Invalid fanfic short plan: " + field + " must be a positive number");
  }
}
