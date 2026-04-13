/**
 * types.ts - 共享类型定义
 */

export interface ChapterMeta {
  title: string;
  target_words?: number;
  mood?: string;
  required_scenes?: string[];
  plot_hooks?: string[];
  transition_notes?: string;
}

export interface NovelState {
  hasOutline: boolean;
  hasCharacters: boolean;
  hasRelationships: boolean;
  hasChapters: boolean;
  hasStorySoFar: boolean;
  chaptersHaveMetadata: boolean;
  existingChapterNums: number[];
}

export async function loadChapters(novelDir: string): Promise<ChapterMeta[] | null> {
  const fs = await import("fs/promises");
  const path = await import("path");
  const raw = await fs.readFile(path.join(novelDir, "_chapters.json"), "utf-8").catch(() => null);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as (string | ChapterMeta)[];
  return parsed.map((c) => (typeof c === "string" ? { title: c } : c));
}
