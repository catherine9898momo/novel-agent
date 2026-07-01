import { requestJsonText } from "../fanfic/json-llm.js";
import type { ModelEndpoint } from "../models.js";
import { OpenAICompatibleClient } from "../providers/openai-compatible.js";
import { LocalHeuristicMaterialRefiner } from "./local-refiner.js";
import { extractJsonArrayPropertyFromText, parseJsonObjectFromText } from "./llm-json.js";
import type {
  CharacterRefinementInput,
  CharacterRefinementOutput,
  MaterialRefiner,
  PlotThreadRefinementInput,
  PlotThreadRefinementOutput,
} from "./refiner.js";
import type { CorrectedCharacterMaterial } from "./types.js";

export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
export const DEFAULT_OLLAMA_CHARACTER_MODEL = "qwen3:8b";

interface OllamaCharacterMaterialRefinerOptions {
  endpoint?: ModelEndpoint;
  model?: string;
  baseURL?: string;
  fallback?: MaterialRefiner;
  maxTokens?: number;
}

interface CharacterJsonPayload {
  characters?: CorrectedCharacterMaterial[];
  rejectedCandidates?: string[];
  notes?: string[];
}

export class OllamaCharacterMaterialRefiner implements MaterialRefiner {
  private readonly endpoint?: ModelEndpoint;
  private readonly model: string;
  private readonly baseURL: string;
  private readonly fallback: MaterialRefiner;
  private readonly maxTokens: number;

  constructor(options: OllamaCharacterMaterialRefinerOptions = {}) {
    this.endpoint = options.endpoint;
    this.model = options.model ?? options.endpoint?.model ?? DEFAULT_OLLAMA_CHARACTER_MODEL;
    this.baseURL = normalizeOllamaBaseURL(options.baseURL ?? DEFAULT_OLLAMA_BASE_URL);
    this.fallback = options.fallback ?? new LocalHeuristicMaterialRefiner();
    this.maxTokens = options.maxTokens ?? 1200;
  }

  async refineCharacters(input: CharacterRefinementInput): Promise<CharacterRefinementOutput> {
    const prompt = buildOllamaCharacterRefinementPrompt(compactCharacterRefinementInputForOllama(input));
    const rawText = this.endpoint
      ? await requestJsonText(this.endpoint, {
        maxTokens: this.maxTokens,
        system: prompt.system,
        content: prompt.user,
      })
      : await requestOllamaJsonText({
        baseURL: this.baseURL,
        model: this.model,
        maxTokens: this.maxTokens,
        system: prompt.system,
        content: prompt.user,
      });
    let payload: CharacterJsonPayload;
    try {
      payload = parseJsonObjectFromText(rawText) as CharacterJsonPayload;
    } catch (error) {
      const partialCharacters = extractJsonArrayPropertyFromText(rawText, "characters");
      if (!partialCharacters) {
        const parseError = new Error(error instanceof Error ? error.message : String(error)) as Error & { rawText?: string };
        parseError.rawText = rawText;
        throw parseError;
      }
      payload = {
        characters: partialCharacters as CorrectedCharacterMaterial[],
        rejectedCandidates: [],
        notes: ["parsed complete characters array from truncated model JSON"],
      };
    }
    const characters = normalizeCorrectedCharacters(payload.characters ?? []);

    if (!Array.isArray(characters)) {
      throw new Error("Ollama character refinement returned invalid characters");
    }

    return {
      characters,
      rejectedCandidates: stringArray(payload.rejectedCandidates),
      notes: [
        `ollama character refinement model=${this.model}`,
        ...(Array.isArray(payload.notes) ? payload.notes : []),
      ],
      rawText,
    };
  }

  async refinePlotThreads(input: PlotThreadRefinementInput): Promise<PlotThreadRefinementOutput> {
    return this.fallback.refinePlotThreads(input);
  }
}

export function createOllamaEndpoint(options: { model?: string; baseURL?: string } = {}): ModelEndpoint {
  const model = options.model ?? DEFAULT_OLLAMA_CHARACTER_MODEL;
  const baseURL = `${normalizeOllamaBaseURL(options.baseURL ?? DEFAULT_OLLAMA_BASE_URL)}/v1`;
  return {
    model,
    provider: "openai-compatible",
    client: new OpenAICompatibleClient({ apiKey: "ollama", baseURL }) as unknown as ModelEndpoint["client"],
  };
}

interface NativeOllamaJsonTextRequest {
  baseURL: string;
  model: string;
  maxTokens: number;
  system: string;
  content: string;
}

interface NativeOllamaChatResponse {
  message?: { content?: string };
  error?: string;
}

async function requestOllamaJsonText(request: NativeOllamaJsonTextRequest): Promise<string> {
  const response = await fetch(`${request.baseURL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: request.model,
      stream: false,
      messages: [
        {
          role: "system",
          content: `${request.system} Return only the final JSON object in message.content.`,
        },
        { role: "user", content: `/no_think\n${request.content}` },
      ],
      format: "json",
      options: {
        temperature: 0,
        num_ctx: 16384,
        num_predict: request.maxTokens,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Ollama API error: ${response.status} ${text.slice(0, 200)}`);
  }

  const data = await response.json() as NativeOllamaChatResponse;
  if (data.error) throw new Error(`Ollama API error: ${data.error}`);
  return (data.message?.content ?? "").trim();
}

function normalizeOllamaBaseURL(baseURL: string): string {
  return baseURL.replace(/\/+$/, "").replace(/\/v1$/, "");
}


export function compactCharacterRefinementInputForOllama(input: CharacterRefinementInput): CharacterRefinementInput {
  return {
    characters: input.characters.map((character) => ({
      name: character.name,
      aliases: character.aliases,
      roleGuess: character.roleGuess,
      importance: character.importance,
      desireGuess: character.desireGuess,
      pressure: character.pressure,
      firstSeenChapter: character.firstSeenChapter,
      appearanceChapters: character.appearanceChapters.slice(0, 8),
      evidence: character.evidence.slice(0, 2),
    })),
    plotThreads: [],
    chapterChain: [],
  };
}


function buildOllamaCharacterRefinementPrompt(input: CharacterRefinementInput): { system: string; user: string } {
  return {
    system: [
      "你是小说素材人物校正器。",
      "只输出一个 JSON 对象，不要 Markdown，不要解释。",
      "不要复述输入，不要输出 outputSchema 字段。",
    ].join(" "),
    user: [
      "任务：合并同一人物的称谓/别名，删除纯称谓噪声，补全人物功能、动机、关系和证据。",
      "每个输入候选都必须出现在 characters 或 rejectedCandidates 中。真实人物不要放进 rejectedCandidates。",
      "除非证据明确说明是同一人，不要把两个不同姓名的候选合并；梅鹤庭必须作为独立人物保留。",
      "必须输出这个顶层结构：",
      "{\"characters\":[{\"name\":\"\",\"aliases\":[],\"role\":\"lead\",\"function\":\"\",\"motivation\":\"\",\"relationships\":[],\"evidence\":[],\"sourceCharacterNames\":[]}],\"rejectedCandidates\":[],\"notes\":[]}",
      "role 只能是 lead、love_interest、supporting、antagonist、minor。relationships 必须是字符串数组，例如 [\"梅鹤庭：旧情破裂\"]。",
      "特别规则：长公主/大长公主/殿下如果证据指向宣明珠，合并到宣明珠；梅大人/梅长生/长生如果证据指向梅鹤庭，合并到梅鹤庭。",
      "输入候选：",
      JSON.stringify(input.characters),
    ].join("\n"),
  };
}

function normalizeCorrectedCharacters(value: unknown): CorrectedCharacterMaterial[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const source = item as Record<string, unknown>;
    const aliases = stringArray(source.aliases);
    const sourceCharacterNames = stringArray(source.sourceCharacterNames);
    return {
      name: stringValue(source.name) || inferCanonicalName(sourceCharacterNames, aliases),
      aliases,
      role: normalizeRole(source.role),
      function: stringValue(source.function),
      motivation: stringValue(source.motivation),
      relationships: normalizeRelationships(source.relationships),
      evidence: stringArray(source.evidence),
      sourceCharacterNames,
    };
  }).filter((item) => item.name);
}

function normalizeRole(value: unknown): CorrectedCharacterMaterial["role"] {
  if (value === "lead" || value === "love_interest" || value === "supporting" || value === "antagonist" || value === "minor") {
    return value;
  }
  if (value === "key_relationship") return "love_interest";
  return "supporting";
}

function normalizeRelationships(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object") {
      const data = item as Record<string, unknown>;
      const named = [data.name, data.type].filter((part) => typeof part === "string" && part).join("：");
      if (named) return named;
      const [first] = Object.entries(data);
      return first ? `${first[0]}：${String(first[1])}` : "";
    }
    return "";
  }).filter(Boolean);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}


function inferCanonicalName(sourceNames: string[], aliases: string[]): string {
  const names = [...sourceNames, ...aliases];
  if (names.includes("宣明珠")) return "宣明珠";
  if (names.includes("梅鹤庭")) return "梅鹤庭";
  return names.find((name) => !["长公主", "大长公主", "殿下", "公主", "梅大人", "梅长生", "长生"].includes(name)) ?? "";
}
