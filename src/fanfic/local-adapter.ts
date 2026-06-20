import fs from "fs/promises";
import path from "path";
import { getArtifactRelativePath } from "./artifacts.js";
import { runFanficCommand, type FanficCommandOptions } from "./commands.js";
import { getNextAllowedAction } from "./state-machine.js";
import {
  initFanficProject,
  loadFanficProjectState,
  resolveFanficProjectDir,
  saveFanficProjectState,
} from "./project.js";
import type { FanficArtifactKey, FanficArtifactStatus, FanficCommand, FanficProjectOptions, FanficProjectState } from "./types.js";

export interface FanficUiArtifactSnapshot {
  path: string;
  status: FanficArtifactStatus;
  updatedAt: string;
  content: unknown;
}

export interface FanficUiSnapshot {
  storyId: string;
  state: FanficProjectState;
  nextAction: FanficCommand | null;
  artifacts: Partial<Record<FanficArtifactKey, FanficUiArtifactSnapshot>>;
}

export interface FanficStoryCardPatch {
  target: "idea" | "canon";
  field: string;
  value: unknown;
}

const JSON_ARTIFACTS = new Set<FanficArtifactKey>(["idea", "canon", "plan", "context", "review"]);
const IDEA_EDITABLE_FIELDS = new Set(["source", "relationship", "timeline", "divergence", "tropes", "dislikes", "rating", "targetWordCount", "ending", "requiredScenes", "summary"]);
const CANON_EDITABLE_FIELDS = new Set(["source", "constraints", "characterNotes", "timelineNotes", "hardCanon", "risks"]);
const ARRAY_FIELDS = new Set(["tropes", "dislikes", "requiredScenes", "constraints", "characterNotes", "timelineNotes", "hardCanon", "risks"]);

export async function initFanficUiSession(
  storyId: string,
  options: FanficProjectOptions = {},
): Promise<FanficUiSnapshot> {
  await initFanficProject(storyId, options);
  return createFanficUiSnapshot(storyId, options);
}

export async function runFanficUiAction(
  storyId: string,
  command: FanficCommand,
  options: FanficCommandOptions = {},
): Promise<FanficUiSnapshot> {
  await runFanficCommand(storyId, command, options);
  return createFanficUiSnapshot(storyId, options);
}

export async function patchFanficUiStoryCard(
  storyId: string,
  patch: FanficStoryCardPatch,
  options: FanficProjectOptions = {},
): Promise<FanficUiSnapshot> {
  const state = await loadFanficProjectState(storyId, options);
  if (state.status !== "idea_pending_confirm" || state.artifacts.idea?.status !== "drafted") {
    throw new Error("Story card is only editable before idea confirmation");
  }
  assertEditablePatch(patch);

  const projectDir = resolveFanficProjectDir(storyId, options);
  const artifactKey = patch.target;
  const filePath = path.join(projectDir, getArtifactRelativePath(artifactKey));
  const current = JSON.parse(await fs.readFile(filePath, "utf-8")) as Record<string, unknown>;
  if (patch.target === "canon" && patch.field === "hardCanon") {
    current.constraints = normalizePatchValue(patch.field, patch.value);
    current.characterNotes = [];
    current.timelineNotes = [];
  } else {
    current[patch.field] = normalizePatchValue(patch.field, patch.value);
  }
  await fs.writeFile(filePath, JSON.stringify(current, null, 2), "utf-8");

  const now = new Date().toISOString();
  const nextState = structuredClone(state) as FanficProjectState;
  const record = nextState.artifacts[artifactKey];
  if (record) record.updatedAt = now;
  nextState.revision += 1;
  nextState.updatedAt = now;
  await saveFanficProjectState(storyId, nextState, options);
  return createFanficUiSnapshot(storyId, options);
}

export async function createFanficUiSnapshot(
  storyId: string,
  options: FanficProjectOptions = {},
): Promise<FanficUiSnapshot> {
  const state = await loadFanficProjectState(storyId, options);
  return {
    storyId,
    state,
    nextAction: getNextAllowedAction(state),
    artifacts: await readArtifactSnapshots(storyId, state, options),
  };
}

async function readArtifactSnapshots(
  storyId: string,
  state: FanficProjectState,
  options: FanficProjectOptions,
): Promise<Partial<Record<FanficArtifactKey, FanficUiArtifactSnapshot>>> {
  const projectDir = resolveFanficProjectDir(storyId, options);
  const snapshots: Partial<Record<FanficArtifactKey, FanficUiArtifactSnapshot>> = {};
  for (const [key, artifact] of Object.entries(state.artifacts)) {
    const artifactKey = key as FanficArtifactKey;
    if (!artifact) continue;
    const content = await readArtifactContent(projectDir, artifactKey).catch(() => null);
    snapshots[artifactKey] = { ...artifact, content };
  }
  return snapshots;
}

async function readArtifactContent(projectDir: string, key: FanficArtifactKey): Promise<unknown> {
  const filePath = path.join(projectDir, getArtifactRelativePath(key));
  const raw = await fs.readFile(filePath, "utf-8");
  if (JSON_ARTIFACTS.has(key)) {
    return JSON.parse(raw);
  }
  return raw;
}


function assertEditablePatch(patch: FanficStoryCardPatch): void {
  const allowed = patch.target === "idea" ? IDEA_EDITABLE_FIELDS : CANON_EDITABLE_FIELDS;
  if (!allowed.has(patch.field)) {
    throw new Error(`Field ${patch.target}.${patch.field} is not editable`);
  }
}

function normalizePatchValue(field: string, value: unknown): unknown {
  if (ARRAY_FIELDS.has(field)) {
    if (Array.isArray(value)) {
      return value.map((item) => String(item).trim()).filter(Boolean);
    }
    if (typeof value === "string") {
      return value.split(/\n+/).map((item) => item.replace(/^[\s•·*-]+/, "").trim()).filter(Boolean);
    }
    throw new Error(`Field ${field} must be a string array`);
  }
  if (field === "targetWordCount") {
    const numberValue = typeof value === "number" ? value : Number(String(value).trim());
    if (!Number.isFinite(numberValue) || numberValue <= 0) throw new Error("targetWordCount must be a positive number");
    return numberValue;
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Field ${field} must be a non-empty string`);
  }
  return value.trim();
}
