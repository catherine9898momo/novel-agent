import { requestJsonText } from "../fanfic/json-llm.js";
import { endpoints, type ModelEndpoint } from "../models.js";
import { LocalHeuristicMaterialRefiner } from "./local-refiner.js";
import { parseJsonObjectFromText } from "./llm-json.js";
import { buildCharacterRefinementPrompt } from "./refiner-prompts.js";
import type {
  CharacterRefinementInput,
  CharacterRefinementOutput,
  MaterialRefiner,
  PlotThreadRefinementInput,
  PlotThreadRefinementOutput,
} from "./refiner.js";
import type { CorrectedCharacterMaterial } from "./types.js";

interface DeepSeekCharacterMaterialRefinerOptions {
  endpoint?: ModelEndpoint;
  fallback?: MaterialRefiner;
  maxTokens?: number;
}

interface CharacterJsonPayload {
  characters?: CorrectedCharacterMaterial[];
  rejectedCandidates?: string[];
  notes?: string[];
}

export class DeepSeekCharacterMaterialRefiner implements MaterialRefiner {
  private readonly endpoint: ModelEndpoint;
  private readonly fallback: MaterialRefiner;
  private readonly maxTokens: number;

  constructor(options: DeepSeekCharacterMaterialRefinerOptions = {}) {
    this.endpoint = options.endpoint ?? endpoints.extract;
    this.fallback = options.fallback ?? new LocalHeuristicMaterialRefiner();
    this.maxTokens = options.maxTokens ?? 6000;
  }

  async refineCharacters(input: CharacterRefinementInput): Promise<CharacterRefinementOutput> {
    const prompt = buildCharacterRefinementPrompt(input);
    const rawText = await requestJsonText(this.endpoint, {
      maxTokens: this.maxTokens,
      system: prompt.system,
      content: prompt.user,
    });
    const payload = parseJsonObjectFromText(rawText) as CharacterJsonPayload;
    const characters = payload.characters ?? [];

    if (!Array.isArray(characters)) {
      throw new Error("DeepSeek character refinement returned invalid characters");
    }

    return {
      characters,
      rejectedCandidates: Array.isArray(payload.rejectedCandidates) ? payload.rejectedCandidates : [],
      notes: Array.isArray(payload.notes) ? payload.notes : [],
    };
  }

  async refinePlotThreads(input: PlotThreadRefinementInput): Promise<PlotThreadRefinementOutput> {
    return this.fallback.refinePlotThreads(input);
  }
}

export { parseJsonObjectFromText };
