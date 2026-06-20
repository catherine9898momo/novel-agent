import { endpoints, type ModelEndpoint } from "../models.js";
import { requestJsonText } from "./json-llm.js";

export interface FanficIdeaCard {
  source: string;
  relationship: string;
  timeline: string;
  divergence: string;
  tropes: string[];
  dislikes: string[];
  rating: string;
  targetWordCount: number;
  ending: string;
  requiredScenes: string[];
  summary: string;
  rawIdea: string;
}

export interface FanficCanonCard {
  source: string;
  constraints: string[];
  characterNotes: string[];
  timelineNotes: string[];
  risks: string[];
  rawIdea: string;
}

export interface ParsedFanficIdea {
  idea: FanficIdeaCard;
  canon: FanficCanonCard;
}

export interface FanficIdeaParserOptions {
  endpoint?: ModelEndpoint;
}

interface RawFanficIdeaCard extends Omit<FanficIdeaCard, "rawIdea"> {
  rawIdea?: string;
}

interface RawFanficCanonCard extends Omit<FanficCanonCard, "rawIdea"> {
  rawIdea?: string;
}

export async function parseFanficIdeaText(
  rawIdea: string,
  options: FanficIdeaParserOptions = {},
): Promise<ParsedFanficIdea> {
  const ideaText = rawIdea.trim();
  if (!ideaText) {
    throw new Error("parse_idea requires ideaText");
  }

  const endpoint = options.endpoint ?? endpoints.idea;
  const rawText = await requestJsonText(endpoint, {
    maxTokens: 1800,
    system: buildSystemPrompt(),
    content: buildUserPrompt(ideaText),
  });

  return normalizeParsedIdea(parseJsonObject(rawText), ideaText);
}

function buildSystemPrompt(): string {
  return [
    "你是同人短篇小说的创意解析器，只负责把用户脑洞拆成结构化故事卡。",
    "不要续写正文，不要生成大纲，不要决定文件路径或流程状态。",
    "必须输出严格 JSON，不要额外解释。",
  ].join("\n");
}

function buildUserPrompt(ideaText: string): string {
  return [
    "请把下面的同人创意解析成 JSON：",
    "",
    ideaText,
    "",
    "JSON schema:",
    "{",
    "  \"idea\": {",
    "    \"source\": \"原作名\",",
    "    \"relationship\": \"CP 或关系\",",
    "    \"timeline\": \"时间线\",",
    "    \"divergence\": \"设定偏离点\",",
    "    \"tropes\": [\"梗\"],",
    "    \"dislikes\": [\"雷点或禁区\"],",
    "    \"rating\": \"尺度\",",
    "    \"targetWordCount\": 5000,",
    "    \"ending\": \"结局倾向\",",
    "    \"requiredScenes\": [\"必须出现的场面\"],",
    "    \"summary\": \"一句话核心故事\"",
    "  },",
    "  \"canon\": {",
    "    \"source\": \"原作名\",",
    "    \"constraints\": [\"原作硬约束\"],",
    "    \"characterNotes\": [\"人物理解\"],",
    "    \"timelineNotes\": [\"时间线注意点\"],",
    "    \"risks\": [\"容易 OOC 或踩雷的风险\"]",
    "  }",
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
    throw new Error("Invalid fanfic idea parse result: LLM output is not valid JSON");
  }
}

function normalizeParsedIdea(value: unknown, rawIdea: string): ParsedFanficIdea {
  if (!isRecord(value) || !isRecord(value.idea) || !isRecord(value.canon)) {
    throw new Error("Invalid fanfic idea parse result: expected idea and canon objects");
  }

  const idea = value.idea as Partial<RawFanficIdeaCard>;
  const canon = value.canon as Partial<RawFanficCanonCard>;

  assertString(idea.source, "idea.source");
  assertString(idea.relationship, "idea.relationship");
  assertString(idea.timeline, "idea.timeline");
  assertString(idea.divergence, "idea.divergence");
  assertStringArray(idea.tropes, "idea.tropes");
  assertStringArray(idea.dislikes, "idea.dislikes");
  assertString(idea.rating, "idea.rating");
  assertPositiveNumber(idea.targetWordCount, "idea.targetWordCount");
  assertString(idea.ending, "idea.ending");
  assertStringArray(idea.requiredScenes, "idea.requiredScenes");
  assertString(idea.summary, "idea.summary");

  assertString(canon.source, "canon.source");
  assertStringArray(canon.constraints, "canon.constraints");
  assertStringArray(canon.characterNotes, "canon.characterNotes");
  assertStringArray(canon.timelineNotes, "canon.timelineNotes");
  assertStringArray(canon.risks, "canon.risks");

  return {
    idea: {
      source: idea.source,
      relationship: idea.relationship,
      timeline: idea.timeline,
      divergence: idea.divergence,
      tropes: idea.tropes,
      dislikes: idea.dislikes,
      rating: idea.rating,
      targetWordCount: idea.targetWordCount,
      ending: idea.ending,
      requiredScenes: idea.requiredScenes,
      summary: idea.summary,
      rawIdea,
    },
    canon: {
      source: canon.source,
      constraints: canon.constraints,
      characterNotes: canon.characterNotes,
      timelineNotes: canon.timelineNotes,
      risks: canon.risks,
      rawIdea,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Invalid fanfic idea parse result: " + field + " must be a non-empty string");
  }
}

function assertStringArray(value: unknown, field: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new Error("Invalid fanfic idea parse result: " + field + " must be a string array");
  }
}

function assertPositiveNumber(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error("Invalid fanfic idea parse result: " + field + " must be a positive number");
  }
}
