import fs from "fs/promises";
import path from "path";
import { MATERIAL_RUNS_ROOT } from "./decomposer.js";
import type {
  ChapterChainItem,
  CharacterMaterial,
  CorrectedMaterialArtifacts,
  CorrectedMaterialPaths,
  MaterialBrief,
  MaterialSource,
  PlotThreadMaterial,
  ReusableMaterial,
} from "./types.js";

interface SplitJson<T> {
  source?: MaterialSource;
  items?: T[];
  data?: T;
}

export interface RawMaterialSplit {
  source?: MaterialSource;
  characters: CharacterMaterial[];
  plotThreads: PlotThreadMaterial[];
  chapterChain: ChapterChainItem[];
  reusableMaterials: ReusableMaterial[];
}

export class FileMaterialStore {
  constructor(private readonly rootDir = MATERIAL_RUNS_ROOT) {}

  async readRawSplit(sourceId: string): Promise<RawMaterialSplit> {
    const splitDir = this.getSplitDir(sourceId);
    const [characters, plotThreads, chapterChain, reusableMaterials] = await Promise.all([
      readSplitItems<CharacterMaterial>(path.join(splitDir, "characters.json")),
      readSplitItems<PlotThreadMaterial>(path.join(splitDir, "plot-threads.json")),
      readSplitItems<ChapterChainItem>(path.join(splitDir, "chapter-chain.json")),
      readOptionalSplitItems<ReusableMaterial>(path.join(splitDir, "reusable-materials.json")),
    ]);

    return {
      source: characters.source ?? plotThreads.source ?? chapterChain.source,
      characters: characters.items,
      plotThreads: plotThreads.items,
      chapterChain: chapterChain.items,
      reusableMaterials: reusableMaterials.items,
    };
  }

  async writeCorrected(
    sourceId: string,
    artifacts: CorrectedMaterialArtifacts,
  ): Promise<CorrectedMaterialPaths> {
    const correctedDir = this.getCorrectedDir(sourceId);
    await fs.mkdir(correctedDir, { recursive: true });

    const paths = {
      characters: path.join(correctedDir, "characters.json"),
      plotThreads: path.join(correctedDir, "plot-threads.json"),
      report: path.join(correctedDir, "refinement-report.json"),
    };

    await Promise.all([
      writeJson(paths.characters, artifacts.characters),
      writeJson(paths.plotThreads, artifacts.plotThreads),
      writeJson(paths.report, artifacts.report),
    ]);

    return paths;
  }

  async readCorrected(sourceId: string): Promise<CorrectedMaterialArtifacts> {
    const correctedDir = this.getCorrectedDir(sourceId);
    const [characters, plotThreads, report] = await Promise.all([
      readJson<CorrectedMaterialArtifacts["characters"]>(path.join(correctedDir, "characters.json")),
      readJson<CorrectedMaterialArtifacts["plotThreads"]>(path.join(correctedDir, "plot-threads.json")),
      readJson<CorrectedMaterialArtifacts["report"]>(path.join(correctedDir, "refinement-report.json")),
    ]);
    return { characters, plotThreads, report };
  }

  async writeMaterialBrief(sourceId: string, brief: MaterialBrief): Promise<string> {
    const correctedDir = this.getCorrectedDir(sourceId);
    await fs.mkdir(correctedDir, { recursive: true });
    const filePath = path.join(correctedDir, "material-brief.json");
    await writeJson(filePath, brief);
    return filePath;
  }

  getRunDir(sourceId: string): string {
    return path.join(this.rootDir, sourceId);
  }

  getSplitDir(sourceId: string): string {
    return path.join(this.getRunDir(sourceId), "split");
  }

  getCorrectedDir(sourceId: string): string {
    return path.join(this.getRunDir(sourceId), "corrected");
  }
}

async function readSplitItems<T>(filePath: string): Promise<{ source?: MaterialSource; items: T[] }> {
  const payload = await readJson<SplitJson<T>>(filePath);
  return { source: payload.source, items: payload.items ?? [] };
}

async function readOptionalSplitItems<T>(filePath: string): Promise<{ source?: MaterialSource; items: T[] }> {
  try {
    return await readSplitItems<T>(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { items: [] };
    }
    throw error;
  }
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf-8")) as T;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
}
