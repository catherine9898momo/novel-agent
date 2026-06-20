import path from "path";
import type { FanficArtifactKey, FanficArtifactRecord, FanficArtifactStatus } from "./types.js";

export const FANFIC_ROOT = "fanfics";

const ARTIFACT_PATHS: Record<FanficArtifactKey, string> = {
  idea: "_idea.json",
  canon: "_canon.json",
  plan: "_plan.json",
  context: path.join("_context", "writer-context-001.json"),
  draft: path.join("_drafts", "draft-001.md"),
  review: path.join("_reviews", "review-001.json"),
  rewriteDraft: path.join("_drafts", "draft-002.md"),
  final: "final.md",
};

export function assertValidStoryId(storyId: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(storyId)) {
    throw new Error("story_id must be ASCII kebab-case, for example: rain-letter");
  }
}

export function getFanficProjectDir(storyId: string, rootDir = FANFIC_ROOT): string {
  assertValidStoryId(storyId);
  return path.join(rootDir, storyId);
}

export function getArtifactRelativePath(key: FanficArtifactKey): string {
  return ARTIFACT_PATHS[key];
}

export function createArtifactRecord(
  key: FanficArtifactKey,
  status: FanficArtifactStatus,
  timestamp: string,
): FanficArtifactRecord {
  return {
    path: ARTIFACT_PATHS[key],
    status,
    updatedAt: timestamp,
  };
}
