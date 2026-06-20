import fs from "fs/promises";
import path from "path";
import {
  FANFIC_ROOT,
  assertValidStoryId,
  getFanficProjectDir,
} from "./artifacts.js";
import {
  createInitialFanficState,
} from "./state-machine.js";
import type { FanficProjectOptions, FanficProjectState } from "./types.js";

export interface FanficProject {
  storyId: string;
  projectDir: string;
  state: FanficProjectState;
}

export function resolveFanficRoot(options: FanficProjectOptions = {}): string {
  return options.rootDir ?? process.env.FANFIC_ROOT ?? FANFIC_ROOT;
}

export function resolveFanficProjectDir(storyId: string, options: FanficProjectOptions = {}): string {
  return getFanficProjectDir(storyId, resolveFanficRoot(options));
}

export async function initFanficProject(
  storyId: string,
  options: FanficProjectOptions = {},
): Promise<FanficProject> {
  assertValidStoryId(storyId);

  const projectDir = resolveFanficProjectDir(storyId, options);
  await fs.mkdir(path.join(projectDir, "_context"), { recursive: true });
  await fs.mkdir(path.join(projectDir, "_drafts"), { recursive: true });
  await fs.mkdir(path.join(projectDir, "_reviews"), { recursive: true });

  const existing = await readStateFile(projectDir);
  const state = existing ?? createInitialFanficState(storyId);
  await saveFanficProjectState(storyId, state, options);

  return { storyId, projectDir, state };
}

export async function loadFanficProjectState(
  storyId: string,
  options: FanficProjectOptions = {},
): Promise<FanficProjectState> {
  assertValidStoryId(storyId);
  const projectDir = resolveFanficProjectDir(storyId, options);
  const state = await readStateFile(projectDir);
  if (!state) {
    throw new Error(`Fanfic project not found: ${storyId}`);
  }
  return state;
}

export async function saveFanficProjectState(
  storyId: string,
  state: FanficProjectState,
  options: FanficProjectOptions = {},
): Promise<void> {
  assertValidStoryId(storyId);
  const projectDir = resolveFanficProjectDir(storyId, options);
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(path.join(projectDir, "_state.json"), JSON.stringify(state, null, 2), "utf-8");
}

async function readStateFile(projectDir: string): Promise<FanficProjectState | null> {
  const raw = await fs.readFile(path.join(projectDir, "_state.json"), "utf-8").catch(() => null);
  if (!raw) return null;
  return JSON.parse(raw) as FanficProjectState;
}
