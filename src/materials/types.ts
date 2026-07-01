export type MaterialKind =
  | "character_archetype"
  | "relationship_dynamic"
  | "plot_pattern"
  | "chapter_hook"
  | "highlight_pattern"
  | "reader_pull";

export interface MaterialSource {
  id: string;
  title: string;
  sourcePath?: string;
  importedAt: string;
  wordCount: number;
  chapterCount: number;
}

export interface BookPhase {
  chapters: string;
  function: string;
  mainConflict: string;
  readerEmotion: string[];
  payoff: string;
}

export interface BookStructure {
  corePromise: string;
  openingHook: string;
  mainThroughline: string;
  phaseArcs: BookPhase[];
}

export interface CharacterMaterial {
  name: string;
  aliases: string[];
  roleGuess: string;
  importance: "lead" | "key_relationship" | "supporting" | "minor";
  mentionCount: number;
  appearanceChapters: number[];
  desireGuess: string;
  pressure: string;
  firstSeenChapter: number;
  evidence: string[];
}

export interface PlotThreadMaterial {
  id: string;
  title: string;
  kind: "main" | "phase" | "subplot" | "mini_arc";
  chapters: string;
  chapterNumbers: number[];
  involvedCharacters: string[];
  summary: string;
  background: string;
  keyEvents: string[];
  outcome: string;
  promise: string;
  conflict: string;
  payoff: string;
  readerPulls: string[];
  childThreadIds: string[];
}

export interface RelationshipArcMaterial {
  characters: string[];
  initialDynamic: string;
  tension: string;
  turningPoints: string[];
  usablePattern: string;
}

export interface ChapterChainItem {
  chapterNumber: number;
  title: string;
  function: string;
  mainEvent: string;
  conflict: string;
  relationshipShift: string;
  highlights: string[];
  readerPulls: string[];
  hookOut: string;
  reusablePattern: string;
}

export interface ReusableMaterial {
  id: string;
  kind: MaterialKind;
  label: string;
  pattern: string;
  tags: string[];
  sourceChapters: number[];
  evidence: string[];
  copyrightSafeNote: string;
}

export interface NovelMaterialDecomposition {
  schemaVersion: 1;
  source: MaterialSource;
  bookStructure: BookStructure;
  characters: CharacterMaterial[];
  relationshipArcs: RelationshipArcMaterial[];
  plotThreads: PlotThreadMaterial[];
  chapterChain: ChapterChainItem[];
  reusableMaterials: ReusableMaterial[];
  reviewChecklist: string[];
}

export type CorrectedCharacterRole =
  | "lead"
  | "love_interest"
  | "supporting"
  | "antagonist"
  | "minor";

export interface CorrectedCharacterMaterial {
  name: string;
  aliases: string[];
  role: CorrectedCharacterRole;
  function: string;
  motivation: string;
  relationships: string[];
  evidence: string[];
  sourceCharacterNames: string[];
}

export interface CorrectedPlotThreadMaterial {
  id: string;
  title: string;
  kind: "main" | "phase" | "subplot" | "mini_arc";
  chapters: string;
  chapterNumbers: number[];
  involvedCharacters: string[];
  background: string;
  summary: string;
  keyEvents: string[];
  outcome: string;
  storyFunction: string;
  readerPull: string;
  evidence: string[];
  sourceThreadIds: string[];
}

export interface RefinementReport {
  sourceId: string;
  refinedAt: string;
  characterCount: number;
  plotThreadCount: number;
  rejectedCharacterCandidates: string[];
  notes: string[];
}

export interface CorrectedMaterialArtifacts {
  characters: CorrectedCharacterMaterial[];
  plotThreads: CorrectedPlotThreadMaterial[];
  report: RefinementReport;
}

export interface MaterialBrief {
  sourceId: string;
  idea: string;
  createdAt: string;
  planningOnly: true;
  characterSeeds: Array<{
    name: string;
    function: string;
    motivation: string;
    usablePattern: string;
  }>;
  relationshipDynamics: string[];
  plotStructures: string[];
  highPoints: string[];
  chapterHooks: string[];
  safetyNotes: string[];
}

export interface DecomposeNovelTextInput {
  sourceId: string;
  title: string;
  text: string;
  sourcePath?: string;
  importedAt?: string;
}

export interface SaveMaterialOptions {
  rootDir?: string;
}

export interface SavedMaterialPaths {
  jsonPath: string;
  reviewPath: string;
  splitDir: string;
  splitPaths: {
    source: string;
    bookStructure: string;
    characters: string;
    relationships: string;
    plotThreads: string;
    chapterChain: string;
    reusableMaterials: string;
    reusableByKindDir: string;
  };
}

export interface CorrectedMaterialPaths {
  characters: string;
  plotThreads: string;
  report: string;
}
