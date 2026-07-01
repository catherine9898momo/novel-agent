import fs from "fs/promises";
import path from "path";
import { OllamaCharacterMaterialRefiner } from "./ollama-refiner.js";
import { FileMaterialStore } from "./store.js";
import type { MaterialRefiner } from "./refiner.js";
import type { CorrectedCharacterMaterial } from "./types.js";

export const DEFAULT_QWEN_CHARACTER_EVAL_MODELS = ["qwen2.5:3b", "qwen2.5:7b"];

export interface CharacterEvalMetrics {
  jsonSuccess: boolean;
  characterCount: number;
  aliasGroupHits: number;
  keyCharacterHits: number;
  noiseNameCount: number;
  completeFieldRate: number;
  coverageRate: number;
  durationMs: number;
  score: number;
}

export interface CharacterModelEvalResult {
  model: string;
  outputDir: string;
  metrics: CharacterEvalMetrics;
  error?: string;
}

export interface CharacterModelEvalSummary {
  sourceId: string;
  createdAt: string;
  models: CharacterModelEvalResult[];
}

interface CharacterEvalOptions {
  durationMs?: number;
  jsonSuccess?: boolean;
  inputCharacterCount?: number;
}

interface RunCharacterModelEvaluationInput {
  sourceId: string;
  rootDir?: string;
  models?: string[];
  baseURL?: string;
  limitCharacters?: number;
  now?: () => string;
  createRefiner?: (model: string) => MaterialRefiner;
}

const ALIAS_GROUPS = [
  { canonical: "宣明珠", aliases: ["长公主", "大长公主", "殿下"] },
  { canonical: "梅鹤庭", aliases: ["梅大人", "梅长生", "长生"] },
];
const KEY_CHARACTERS = ["宣明珠", "梅鹤庭"];
const NOISE_NAMES = ["长公主", "大长公主", "殿下", "梅大人", "梅长生", "长生"];

export function evaluateCorrectedCharacters(
  characters: CorrectedCharacterMaterial[],
  options: CharacterEvalOptions = {},
): CharacterEvalMetrics {
  const names = new Set(characters.map((character) => character.name));
  const aliasGroupHits = ALIAS_GROUPS.filter((group) => {
    const matched = characters.find((character) => character.name === group.canonical);
    if (!matched) return false;
    return group.aliases.some((alias) => matched.aliases.includes(alias) || matched.sourceCharacterNames.includes(alias));
  }).length;
  const keyCharacterHits = KEY_CHARACTERS.filter((name) => names.has(name)).length;
  const noiseNameCount = characters.filter((character) => NOISE_NAMES.includes(character.name)).length;
  const filledFields = characters.reduce((sum, character) => {
    return sum
      + nonEmpty(character.function)
      + nonEmpty(character.motivation)
      + nonEmptyArray(character.evidence)
      + nonEmptyArray(character.sourceCharacterNames);
  }, 0);
  const totalFields = Math.max(characters.length * 4, 1);
  const completeFieldRate = filledFields / totalFields;
  const coverageRate = Math.min(1, characters.length / Math.max(options.inputCharacterCount ?? characters.length, 1));
  const score = Math.max(0, Math.round(
    aliasGroupHits * 20
    + keyCharacterHits * 20
    + completeFieldRate * 20
    + coverageRate * 30
    - noiseNameCount * 10,
  ));

  return {
    jsonSuccess: options.jsonSuccess ?? true,
    characterCount: characters.length,
    aliasGroupHits,
    keyCharacterHits,
    noiseNameCount,
    completeFieldRate,
    coverageRate,
    durationMs: options.durationMs ?? 0,
    score,
  };
}

export async function runCharacterModelEvaluation(
  input: RunCharacterModelEvaluationInput,
): Promise<CharacterModelEvalSummary> {
  const models = input.models ?? DEFAULT_QWEN_CHARACTER_EVAL_MODELS;
  const store = new FileMaterialStore(input.rootDir);
  const raw = await store.readRawSplit(input.sourceId);
  const refinementInput = input.limitCharacters
    ? { ...raw, characters: raw.characters.slice(0, input.limitCharacters) }
    : raw;
  const rootDir = input.rootDir ?? "materials/runs";
  const evalRoot = path.join(rootDir, input.sourceId, "evals", "characters");
  await fs.mkdir(evalRoot, { recursive: true });

  const results: CharacterModelEvalResult[] = [];
  for (const model of models) {
    const startedAt = Date.now();
    const outputDir = path.join(evalRoot, safeModelName(model));
    await fs.mkdir(outputDir, { recursive: true });

    try {
      const refiner = input.createRefiner?.(model) ?? new OllamaCharacterMaterialRefiner({
        model,
        baseURL: input.baseURL,
      });
      const output = await refiner.refineCharacters(refinementInput);
      if (refinementInput.characters.length > 0 && output.characters.length === 0) {
        const emptyError = new Error("Model returned zero characters for non-empty character input") as Error & { rawText?: string };
        emptyError.rawText = output.rawText;
        throw emptyError;
      }

      const durationMs = Date.now() - startedAt;
      const metrics = evaluateCorrectedCharacters(output.characters, { durationMs, jsonSuccess: true, inputCharacterCount: refinementInput.characters.length });
      const result = { model, outputDir, metrics };

      if (output.rawText) {
        await fs.writeFile(path.join(outputDir, "raw-response.txt"), output.rawText, "utf-8");
      }
      await writeJson(path.join(outputDir, "characters.json"), output.characters);
      await writeJson(path.join(outputDir, "report.json"), {
        model,
        rejectedCandidates: output.rejectedCandidates,
        notes: output.notes,
      });
      await writeJson(path.join(outputDir, "metrics.json"), metrics);
      results.push(result);
    } catch (error) {
      const metrics = evaluateCorrectedCharacters([], {
        durationMs: Date.now() - startedAt,
        jsonSuccess: false,
        inputCharacterCount: refinementInput.characters.length,
      });
      const rawText = typeof error === "object" && error !== null && "rawText" in error
        ? String((error as { rawText?: unknown }).rawText ?? "")
        : "";
      const result = {
        model,
        outputDir,
        metrics,
        error: error instanceof Error ? error.message : String(error),
      };
      if (rawText) {
        await fs.writeFile(path.join(outputDir, "raw-response.txt"), rawText, "utf-8");
      }
      await writeJson(path.join(outputDir, "metrics.json"), metrics);
      await writeJson(path.join(outputDir, "error.json"), { error: result.error });
      results.push(result);
    }
  }

  const summary = {
    sourceId: input.sourceId,
    createdAt: input.now?.() ?? new Date().toISOString(),
    models: results,
  };
  await writeJson(path.join(evalRoot, "summary.json"), summary);
  return summary;
}

function nonEmpty(value: string): number {
  return value.trim() ? 1 : 0;
}

function nonEmptyArray(values: string[]): number {
  return values.length > 0 ? 1 : 0;
}

function safeModelName(model: string): string {
  return model.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
}
