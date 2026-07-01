export type StoryWindowKind = "opening_arc" | "mini_arc" | "subplot" | "phase_arc" | "fallback_window";
export type StoryWindowSource = "plot_threads" | "chapter_chain" | "fallback" | "llm_corrected";

export interface StoryWindowConfidence {
  ruleScore: number;
  llmScore: number | null;
  llmModel: string | null;
  reasons: string[];
  llmReasons: string[] | null;
}

export interface StoryWindow {
  id: string;
  chapterRange: string;
  chapterNumbers: number[];
  kind: StoryWindowKind;
  title: string;
  summary: string;
  mainConflict: string;
  involvedCharacters: string[];
  startReason: string;
  endReason: string;
  source: StoryWindowSource;
  sourceThreadIds: string[];
  confidence: StoryWindowConfidence;
  qualityFlags: string[];
}

export interface StoryWindowQualityMetrics {
  chapterCount: number;
  windowCount: number;
  coveredChapterCount: number;
  coverageRate: number;
  overlappingChapters: number[];
  uncoveredChapters: number[];
  averageWindowSize: number;
  sourceCounts: Record<StoryWindowSource, number>;
  lowConfidenceWindowCount: number;
  tooLongWindowCount: number;
  tooShortWindowCount: number;
}

export interface StoryWindowSummary {
  sourceId: string;
  createdAt: string;
  windowCount: number;
  metrics: StoryWindowQualityMetrics;
}

export interface StoryWindowArtifactPaths {
  storyWindows: string;
  preview: string;
  qualityReport: string;
  summary: string;
}
