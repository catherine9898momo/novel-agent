import type {
  ChapterChainItem,
  CharacterMaterial,
  CorrectedCharacterMaterial,
  CorrectedMaterialArtifacts,
  CorrectedPlotThreadMaterial,
  PlotThreadMaterial,
  RefinementReport,
} from "./types.js";

export interface CharacterRefinementInput {
  characters: CharacterMaterial[];
  plotThreads: PlotThreadMaterial[];
  chapterChain: ChapterChainItem[];
}

export interface CharacterRefinementOutput {
  characters: CorrectedCharacterMaterial[];
  rejectedCandidates: string[];
  notes: string[];
  rawText?: string;
}

export interface PlotThreadRefinementInput {
  plotThreads: PlotThreadMaterial[];
  characters: CorrectedCharacterMaterial[];
  chapterChain: ChapterChainItem[];
}

export interface PlotThreadRefinementOutput {
  plotThreads: CorrectedPlotThreadMaterial[];
  notes: string[];
}

export interface MaterialRefiner {
  refineCharacters(input: CharacterRefinementInput): Promise<CharacterRefinementOutput>;
  refinePlotThreads(input: PlotThreadRefinementInput): Promise<PlotThreadRefinementOutput>;
}

export interface MaterialStoreForRefinement {
  readRawSplit(sourceId: string): Promise<CharacterRefinementInput>;
  writeCorrected(sourceId: string, artifacts: CorrectedMaterialArtifacts): Promise<unknown>;
}

export interface RefineMaterialsInput {
  sourceId: string;
  store: MaterialStoreForRefinement;
  refiner: MaterialRefiner;
  now?: () => string;
}

export async function refineMaterials(input: RefineMaterialsInput): Promise<CorrectedMaterialArtifacts> {
  const raw = await input.store.readRawSplit(input.sourceId);
  const characterOutput = await input.refiner.refineCharacters({
    characters: raw.characters,
    plotThreads: raw.plotThreads,
    chapterChain: raw.chapterChain,
  });
  const plotThreadOutput = await input.refiner.refinePlotThreads({
    plotThreads: raw.plotThreads,
    characters: characterOutput.characters,
    chapterChain: raw.chapterChain,
  });
  const report: RefinementReport = {
    sourceId: input.sourceId,
    refinedAt: input.now?.() ?? new Date().toISOString(),
    characterCount: characterOutput.characters.length,
    plotThreadCount: plotThreadOutput.plotThreads.length,
    rejectedCharacterCandidates: characterOutput.rejectedCandidates,
    notes: [...characterOutput.notes, ...plotThreadOutput.notes],
  };
  const artifacts = {
    characters: characterOutput.characters,
    plotThreads: plotThreadOutput.plotThreads,
    report,
  };

  await input.store.writeCorrected(input.sourceId, artifacts);
  return artifacts;
}
