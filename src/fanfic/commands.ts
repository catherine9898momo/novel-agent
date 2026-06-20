import fs from "fs/promises";
import path from "path";
import {
  getArtifactRelativePath,
} from "./artifacts.js";
import {
  loadFanficProjectState,
  resolveFanficProjectDir,
  saveFanficProjectState,
} from "./project.js";
import { parseFanficIdeaText, type FanficCanonCard, type FanficIdeaCard, type ParsedFanficIdea } from "./idea-parser.js";
import { draftFanficShortStory } from "./drafter.js";
import { reviewFanficDraft, type FanficReview } from "./reviewer.js";
import { rewriteFanficDraft } from "./rewriter.js";
import { planFanficShortStory, type FanficShortPlan } from "./short-planner.js";
import { buildFanficWriterContext, type FanficWriterContext } from "./writer-context.js";
import { transitionFanficState } from "./state-machine.js";
import type { FanficArtifactKey, FanficCommand, FanficProjectOptions, FanficProjectState } from "./types.js";

export type FanficIdeaParser = (ideaText: string) => Promise<ParsedFanficIdea>;
export type FanficShortPlanner = (idea: FanficIdeaCard, canon: FanficCanonCard) => Promise<FanficShortPlan>;
export type FanficDraftWriter = (context: FanficWriterContext) => Promise<string>;
export type FanficDraftReviewer = (context: FanficWriterContext, draft: string) => Promise<FanficReview>;
export type FanficDraftRewriter = (context: FanficWriterContext, draft: string, review: FanficReview) => Promise<string>;

export interface FanficCommandOptions extends FanficProjectOptions {
  ideaText?: string;
  ideaParser?: FanficIdeaParser;
  planPlanner?: FanficShortPlanner;
  draftWriter?: FanficDraftWriter;
  draftReviewer?: FanficDraftReviewer;
  draftRewriter?: FanficDraftRewriter;
}

export async function runFanficCommand(
  storyId: string,
  command: FanficCommand,
  options: FanficCommandOptions = {},
): Promise<FanficProjectState> {
  const current = await loadFanficProjectState(storyId, options);

  if (command === "parse_idea") {
    const parsed = await parseIdeaArtifact(options);
    const next = transitionFanficState(current, command);
    await writeParsedIdeaArtifacts(storyId, parsed, options);
    await saveFanficProjectState(storyId, next, options);
    return next;
  }

  if (command === "generate_plan") {
    const next = transitionFanficState(current, command);
    const plan = await planArtifact(storyId, options);
    await writeJsonArtifact(storyId, "plan", plan, options);
    await saveFanficProjectState(storyId, next, options);
    return next;
  }

  if (command === "generate_draft") {
    const next = transitionFanficState(current, command);
    const { context, draft } = await draftArtifacts(storyId, options);
    await writeJsonArtifact(storyId, "context", context, options);
    await writeTextArtifact(storyId, "draft", draft, options);
    await saveFanficProjectState(storyId, next, options);
    return next;
  }

  if (command === "run_review") {
    const next = transitionFanficState(current, command);
    const review = await reviewArtifact(storyId, options);
    await writeJsonArtifact(storyId, "review", review, options);
    await saveFanficProjectState(storyId, next, options);
    return next;
  }

  if (command === "generate_rewrite") {
    const next = transitionFanficState(current, command);
    const rewrite = await rewriteArtifact(storyId, options);
    await writeTextArtifact(storyId, "rewriteDraft", rewrite, options);
    await saveFanficProjectState(storyId, next, options);
    return next;
  }

  if (command === "accept_final") {
    const next = transitionFanficState(current, command);
    const finalText = await readCurrentConfirmedDraft(storyId, current, options);
    await writeTextArtifact(storyId, "final", finalText, options);
    await saveFanficProjectState(storyId, next, options);
    return next;
  }

  const next = transitionFanficState(current, command);
  await writeCommandArtifacts(storyId, command, next, options);
  await saveFanficProjectState(storyId, next, options);
  return next;
}

async function parseIdeaArtifact(options: FanficCommandOptions): Promise<ParsedFanficIdea> {
  const ideaText = options.ideaText?.trim();
  if (!ideaText) {
    throw new Error("parse_idea requires ideaText");
  }
  const parser = options.ideaParser ?? parseFanficIdeaText;
  return parser(ideaText);
}

async function planArtifact(storyId: string, options: FanficCommandOptions): Promise<FanficShortPlan> {
  const idea = await readJsonArtifact<FanficIdeaCard>(storyId, "idea", options);
  const canon = await readJsonArtifact<FanficCanonCard>(storyId, "canon", options);
  const planner = options.planPlanner ?? planFanficShortStory;
  return planner(idea, canon);
}

async function draftArtifacts(
  storyId: string,
  options: FanficCommandOptions,
): Promise<{ context: FanficWriterContext; draft: string }> {
  const idea = await readJsonArtifact<FanficIdeaCard>(storyId, "idea", options);
  const canon = await readJsonArtifact<FanficCanonCard>(storyId, "canon", options);
  const plan = await readJsonArtifact<FanficShortPlan>(storyId, "plan", options);
  const context = buildFanficWriterContext(idea, canon, plan);
  const writer = options.draftWriter ?? draftFanficShortStory;
  const draft = await writer(context);
  return { context, draft };
}

async function reviewArtifact(storyId: string, options: FanficCommandOptions): Promise<FanficReview> {
  const context = await readJsonArtifact<FanficWriterContext>(storyId, "context", options);
  const draft = await readCurrentDraftText(storyId, options);
  const reviewer = options.draftReviewer ?? reviewFanficDraft;
  return reviewer(context, draft);
}

async function rewriteArtifact(storyId: string, options: FanficCommandOptions): Promise<string> {
  const context = await readJsonArtifact<FanficWriterContext>(storyId, "context", options);
  const draft = await readCurrentDraftText(storyId, options);
  const review = await readJsonArtifact<FanficReview>(storyId, "review", options);
  const rewriter = options.draftRewriter ?? rewriteFanficDraft;
  return rewriter(context, draft, review);
}

async function writeParsedIdeaArtifacts(
  storyId: string,
  parsed: ParsedFanficIdea,
  options: FanficProjectOptions,
): Promise<void> {
  await writeJsonArtifact(storyId, "idea", parsed.idea, options);
  await writeJsonArtifact(storyId, "canon", parsed.canon, options);
}

async function writeJsonArtifact(
  storyId: string,
  key: FanficArtifactKey,
  value: unknown,
  options: FanficProjectOptions,
): Promise<void> {
  const projectDir = resolveFanficProjectDir(storyId, options);
  const relativePath = getArtifactRelativePath(key);
  const filePath = path.join(projectDir, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
}

async function readCurrentDraftText(storyId: string, options: FanficProjectOptions): Promise<string> {
  const projectDir = resolveFanficProjectDir(storyId, options);
  const rewritePath = path.join(projectDir, getArtifactRelativePath("rewriteDraft"));
  const rewrite = await fs.readFile(rewritePath, "utf-8").catch(() => null);
  if (rewrite) return rewrite;
  return fs.readFile(path.join(projectDir, getArtifactRelativePath("draft")), "utf-8");
}

async function readCurrentConfirmedDraft(
  storyId: string,
  state: FanficProjectState,
  options: FanficProjectOptions,
): Promise<string> {
  const projectDir = resolveFanficProjectDir(storyId, options);
  if (state.artifacts.rewriteDraft?.status === "confirmed") {
    return fs.readFile(path.join(projectDir, getArtifactRelativePath("rewriteDraft")), "utf-8");
  }
  return fs.readFile(path.join(projectDir, getArtifactRelativePath("draft")), "utf-8");
}

async function writeTextArtifact(
  storyId: string,
  key: FanficArtifactKey,
  value: string,
  options: FanficProjectOptions,
): Promise<void> {
  const projectDir = resolveFanficProjectDir(storyId, options);
  const relativePath = getArtifactRelativePath(key);
  const filePath = path.join(projectDir, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, "utf-8");
}

async function readJsonArtifact<T>(
  storyId: string,
  key: FanficArtifactKey,
  options: FanficProjectOptions,
): Promise<T> {
  const projectDir = resolveFanficProjectDir(storyId, options);
  const filePath = path.join(projectDir, getArtifactRelativePath(key));
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

async function writeCommandArtifacts(
  storyId: string,
  command: FanficCommand,
  state: FanficProjectState,
  options: FanficProjectOptions,
): Promise<void> {
  const keys = artifactKeysForCommand(command);
  for (const key of keys) {
    await writeMockArtifact(storyId, key, state, options);
  }
}

function artifactKeysForCommand(command: FanficCommand): FanficArtifactKey[] {
  switch (command) {
    case "parse_idea":
      return ["idea", "canon"];
    case "generate_plan":
      return [];
    case "generate_draft":
      return [];
    case "run_review":
      return [];
    case "generate_rewrite":
      return [];
    case "accept_final":
      return [];
    case "approve_idea":
    case "approve_plan":
    case "approve_draft":
      return [];
  }
}

async function writeMockArtifact(
  storyId: string,
  key: FanficArtifactKey,
  state: FanficProjectState,
  options: FanficProjectOptions,
): Promise<void> {
  const projectDir = resolveFanficProjectDir(storyId, options);
  const relativePath = getArtifactRelativePath(key);
  const filePath = path.join(projectDir, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, mockArtifactContent(storyId, key, state), "utf-8");
}

function mockArtifactContent(
  storyId: string,
  key: FanficArtifactKey,
  state: FanficProjectState,
): string {
  if (key === "draft" || key === "rewriteDraft" || key === "final") {
    const label = key === "draft" ? "初稿" : key === "rewriteDraft" ? "改写稿" : "终稿";
    return `# ${label}\n\n> Phase 1 mock artifact for ${storyId}\n> Status: ${state.status}\n> Revision: ${state.revision}\n`;
  }

  return JSON.stringify({
    mock: true,
    storyId,
    artifact: key,
    status: state.artifacts[key]?.status,
    workflowStatus: state.status,
    revision: state.revision,
    createdBy: "phase1-command-skeleton",
  }, null, 2);
}
