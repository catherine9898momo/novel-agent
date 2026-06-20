import {
  createArtifactRecord,
} from "./artifacts.js";
import type {
  FanficCommand,
  FanficProjectState,
  FanficStatus,
} from "./types.js";

export type { FanficCommand, FanficProjectState, FanficStatus } from "./types.js";

export function createInitialFanficState(storyId: string, timestamp = new Date().toISOString()): FanficProjectState {
  return {
    storyId,
    status: "idea_pending_confirm",
    revision: 0,
    artifacts: {},
    history: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function getNextAllowedAction(state: FanficProjectState): FanficCommand | null {
  switch (state.status) {
    case "idea_pending_confirm":
      return state.artifacts.idea?.status === "drafted" ? "approve_idea" : "parse_idea";
    case "idea_confirmed":
      return "generate_plan";
    case "plan_pending_confirm":
      return "approve_plan";
    case "plan_confirmed":
      return "generate_draft";
    case "draft_pending_confirm":
      return "approve_draft";
    case "review_pending_confirm":
      return "run_review";
    case "rewrite_pending_confirm":
      return "generate_rewrite";
    case "accepted":
    case "blocked":
      return null;
  }
}

export function transitionFanficState(
  state: FanficProjectState,
  command: FanficCommand,
  timestamp = new Date().toISOString(),
): FanficProjectState {
  const next = structuredClone(state) as FanficProjectState;
  const fromStatus = state.status;

  switch (state.status) {
    case "idea_pending_confirm":
      if (command === "parse_idea" && !state.artifacts.idea) {
        next.status = "idea_pending_confirm";
        next.artifacts.idea = createArtifactRecord("idea", "drafted", timestamp);
        next.artifacts.canon = createArtifactRecord("canon", "drafted", timestamp);
        break;
      }
      if (command === "approve_idea" && state.artifacts.idea?.status === "drafted") {
        next.status = "idea_confirmed";
        next.artifacts.idea = createArtifactRecord("idea", "confirmed", timestamp);
        next.artifacts.canon = createArtifactRecord("canon", "confirmed", timestamp);
        break;
      }
      throwNotAllowed(command, state.status);

    case "idea_confirmed":
      if (command === "generate_plan") {
        next.status = "plan_pending_confirm";
        next.artifacts.plan = createArtifactRecord("plan", "drafted", timestamp);
        break;
      }
      throwNotAllowed(command, state.status);

    case "plan_pending_confirm":
      if (command === "approve_plan" && state.artifacts.plan?.status === "drafted") {
        next.status = "plan_confirmed";
        next.artifacts.plan = createArtifactRecord("plan", "confirmed", timestamp);
        break;
      }
      throwNotAllowed(command, state.status);

    case "plan_confirmed":
      if (command === "generate_draft") {
        next.status = "draft_pending_confirm";
        next.artifacts.context = createArtifactRecord("context", "created", timestamp);
        next.artifacts.draft = createArtifactRecord("draft", "drafted", timestamp);
        break;
      }
      throwNotAllowed(command, state.status);

    case "draft_pending_confirm":
      if (command === "approve_draft") {
        next.status = "review_pending_confirm";
        if (state.artifacts.rewriteDraft?.status === "drafted") {
          next.artifacts.rewriteDraft = createArtifactRecord("rewriteDraft", "confirmed", timestamp);
        } else if (state.artifacts.draft?.status === "drafted") {
          next.artifacts.draft = createArtifactRecord("draft", "confirmed", timestamp);
        }
        break;
      }
      throwNotAllowed(command, state.status);

    case "review_pending_confirm":
      if (command === "run_review") {
        next.status = "rewrite_pending_confirm";
        next.artifacts.review = createArtifactRecord("review", "created", timestamp);
        break;
      }
      throwNotAllowed(command, state.status);

    case "rewrite_pending_confirm":
      if (command === "generate_rewrite") {
        next.status = "draft_pending_confirm";
        next.artifacts.rewriteDraft = createArtifactRecord("rewriteDraft", "drafted", timestamp);
        break;
      }
      if (command === "accept_final") {
        next.status = "accepted";
        next.artifacts.final = createArtifactRecord("final", "accepted", timestamp);
        break;
      }
      throwNotAllowed(command, state.status);

    case "accepted":
    case "blocked":
      throwNotAllowed(command, state.status);
  }

  next.revision += 1;
  next.updatedAt = timestamp;
  next.lastError = undefined;
  next.history.push({
    command,
    fromStatus,
    toStatus: next.status,
    timestamp,
  });
  return next;
}

function throwNotAllowed(command: FanficCommand, status: FanficStatus): never {
  throw new Error(`Command ${command} is not allowed from status ${status}`);
}
