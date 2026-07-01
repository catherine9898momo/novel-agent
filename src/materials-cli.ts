import path from "path";
import { composeMaterialBrief } from "./materials/brief-composer.js";
import {
  generateCharacterCardsForSource,
  parseChapterRange,
} from "./materials/character-card.js";
import {
  DEFAULT_QWEN_CHARACTER_EVAL_MODELS,
  runCharacterModelEvaluation,
} from "./materials/character-eval.js";
import { DeepSeekCharacterMaterialRefiner } from "./materials/deepseek-refiner.js";
import {
  decomposeNovelText,
  saveMaterialDecomposition,
} from "./materials/decomposer.js";
import { LocalHeuristicMaterialRefiner } from "./materials/local-refiner.js";
import { OllamaCharacterMaterialRefiner } from "./materials/ollama-refiner.js";
import { refineMaterials } from "./materials/refiner.js";
import { FileMaterialStore } from "./materials/store.js";
import { planStoryWindowsForSource } from "./materials/story-window-planner.js";
import { readNovelTextFile } from "./materials/text-file.js";

const USAGE = `
用法:
  npm run materials -- decompose --source <txt路径> --id <source_id> [--title <标题>] [--out <目录>]
  npm run materials -- refine --id <source_id> [--refiner local|deepseek|ollama] [--model <模型>] [--base-url <地址>] [--out <目录>]
  npm run materials -- brief --id <source_id> --idea <一句创作思路> [--out <目录>]
  npm run materials -- character-cards --id <source_id> --chapters <起止章> [--out <目录>]
  npm run materials -- plan-windows --id <source_id> [--min-size <数量>] [--max-size <数量>] [--out <目录>]
  npm run materials -- eval-characters --id <source_id> [--models qwen3:4b,qwen3:8b,qwen3:14b] [--limit-characters <数量>] [--base-url <地址>] [--out <目录>]

示例:
  npm run materials -- decompose --source "downloads/《长公主病入膏肓后》作者：晏闲.txt" --id chang-gong-zhu
  npm run materials -- refine --id chang-gong-zhu
  npm run materials -- brief --id chang-gong-zhu --idea "女主重生后不再倒贴旧爱"
  npm run materials -- character-cards --id chang-gong-zhu --chapters 1-2
  npm run materials -- plan-windows --id chang-gong-zhu
  npm run materials -- eval-characters --id chang-gong-zhu

source_id 建议使用 ASCII kebab-case，输出默认在 materials/runs/<source_id>/。
`;

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (command === "decompose") {
    await runDecompose(args);
    return;
  }

  if (command === "refine") {
    await runRefine(args);
    return;
  }

  if (command === "brief") {
    await runBrief(args);
    return;
  }

  if (command === "character-cards") {
    await runCharacterCards(args);
    return;
  }

  if (command === "plan-windows") {
    await runPlanWindows(args);
    return;
  }

  if (command === "eval-characters") {
    await runEvalCharacters(args);
    return;
  }

  console.log(USAGE);
}

async function runDecompose(args: string[]): Promise<void> {
  const sourcePath = readFlag(args, "--source");
  const sourceId = readFlag(args, "--id");
  if (!sourcePath || !sourceId) {
    console.log(USAGE);
    return;
  }

  const title = readFlag(args, "--title") ?? inferTitleFromPath(sourcePath);
  const outDir = readFlag(args, "--out");
  const text = await readNovelTextFile(sourcePath);
  const result = decomposeNovelText({
    sourceId,
    title,
    text,
    sourcePath,
  });
  const saved = await saveMaterialDecomposition(result, { rootDir: outDir });

  console.log(`已拆解: ${title}`);
  console.log("JSON: " + saved.jsonPath);
  console.log("Review: " + saved.reviewPath);
  console.log("Split: " + saved.splitDir);
  console.log(`章节数: ${result.source.chapterCount}`);
  console.log(`可复用素材: ${result.reusableMaterials.length}`);
}

async function runRefine(args: string[]): Promise<void> {
  const sourceId = readFlag(args, "--id");
  if (!sourceId) {
    console.log(USAGE);
    return;
  }

  const store = new FileMaterialStore(readFlag(args, "--out"));
  const refinerName = readFlag(args, "--refiner") ?? "local";
  const result = await refineMaterials({
    sourceId,
    store,
    refiner: createMaterialRefiner(refinerName, args),
  });

  console.log(`已校正: ${sourceId}`);
  console.log(`校正器: ${refinerName}`);
  console.log(`人物: ${result.characters.length}`);
  console.log(`剧情线: ${result.plotThreads.length}`);
  console.log("Corrected: " + store.getCorrectedDir(sourceId));
}

async function runBrief(args: string[]): Promise<void> {
  const sourceId = readFlag(args, "--id");
  const idea = readFlag(args, "--idea");
  if (!sourceId || !idea) {
    console.log(USAGE);
    return;
  }

  const store = new FileMaterialStore(readFlag(args, "--out"));
  const corrected = await store.readCorrected(sourceId);
  const brief = composeMaterialBrief({
    sourceId,
    idea,
    characters: corrected.characters,
    plotThreads: corrected.plotThreads,
  });
  const briefPath = await store.writeMaterialBrief(sourceId, brief);

  console.log(`已生成 planning brief: ${sourceId}`);
  console.log("Brief: " + briefPath);
  console.log(`人物种子: ${brief.characterSeeds.length}`);
  console.log(`剧情结构: ${brief.plotStructures.length}`);
}

async function runCharacterCards(args: string[]): Promise<void> {
  const sourceId = readFlag(args, "--id");
  const chapters = readFlag(args, "--chapters");
  if (!sourceId || !chapters) {
    console.log(USAGE);
    return;
  }

  const result = await generateCharacterCardsForSource({
    sourceId,
    rootDir: readFlag(args, "--out"),
    chapterRange: parseChapterRange(chapters),
  });

  console.log(`已生成人物素材卡: ${sourceId} 第 ${result.summary.chapterRange} 章`);
  console.log(`可入库卡: ${result.cards.length}`);
  console.log(`Review issues: ${result.reviewIssues.length}`);
  console.log("Preview: " + result.paths.preview);
  console.log("Cards: " + result.paths.cards);
  console.log("Quality Report: " + result.paths.qualityReport);
  console.log("Review Issues: " + result.paths.reviewIssues);
  console.log("Summary: " + result.paths.summary);
}

async function runPlanWindows(args: string[]): Promise<void> {
  const sourceId = readFlag(args, "--id");
  if (!sourceId) {
    console.log(USAGE);
    return;
  }

  const result = await planStoryWindowsForSource({
    sourceId,
    rootDir: readFlag(args, "--out"),
    minSize: readNumberFlag(args, "--min-size"),
    maxSize: readNumberFlag(args, "--max-size"),
  });

  console.log(`已规划剧情窗口: ${sourceId}`);
  console.log(`窗口数: ${result.windows.length}`);
  console.log(`覆盖率: ${result.summary.metrics.coverageRate}`);
  console.log(`低置信窗口: ${result.summary.metrics.lowConfidenceWindowCount}`);
  console.log("Preview: " + result.paths.preview);
  console.log("Story Windows: " + result.paths.storyWindows);
  console.log("Quality Report: " + result.paths.qualityReport);
  console.log("Summary: " + result.paths.summary);
}

async function runEvalCharacters(args: string[]): Promise<void> {
  const sourceId = readFlag(args, "--id");
  if (!sourceId) {
    console.log(USAGE);
    return;
  }

  const models = parseModels(readFlag(args, "--models"));
  const summary = await runCharacterModelEvaluation({
    sourceId,
    rootDir: readFlag(args, "--out"),
    models,
    baseURL: readFlag(args, "--base-url"),
    limitCharacters: readNumberFlag(args, "--limit-characters"),
  });

  console.log(`已完成人物模型评测: ${sourceId}`);
  console.log(`模型: ${models.join("、")}`);
  for (const item of summary.models) {
    const status = item.error ? `失败: ${item.error}` : `score=${item.metrics.score}`;
    console.log(`- ${item.model}: ${status}, characters=${item.metrics.characterCount}, aliasHits=${item.metrics.aliasGroupHits}, noise=${item.metrics.noiseNameCount}`);
  }
  console.log(`Summary: ${(readFlag(args, "--out") ?? "materials/runs")}/${sourceId}/evals/characters/summary.json`);
}

function createMaterialRefiner(refinerName: string, args: string[]) {
  if (refinerName === "deepseek") return new DeepSeekCharacterMaterialRefiner();
  if (refinerName === "ollama") {
    return new OllamaCharacterMaterialRefiner({
      model: readFlag(args, "--model"),
      baseURL: readFlag(args, "--base-url"),
    });
  }
  return new LocalHeuristicMaterialRefiner();
}

function parseModels(value: string | undefined): string[] {
  if (!value) return DEFAULT_QWEN_CHARACTER_EVAL_MODELS;
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function readNumberFlag(args: string[], flag: string): number | undefined {
  const value = readFlag(args, flag);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function inferTitleFromPath(sourcePath: string): string {
  return path.basename(sourcePath, path.extname(sourcePath))
    .replace(/^《(.+)》作者[:：].+$/, "$1")
    .replace(/^(.+?)作者[:：].+$/, "$1")
    .trim();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
