export type FanficStatus =
  | "idea_pending_confirm"
  | "idea_confirmed"
  | "plan_pending_confirm"
  | "plan_confirmed"
  | "draft_pending_confirm"
  | "review_pending_confirm"
  | "rewrite_pending_confirm"
  | "accepted"
  | "blocked";

export type FanficCommand =
  | "parse_idea"
  | "approve_idea"
  | "generate_plan"
  | "approve_plan"
  | "generate_draft"
  | "approve_draft"
  | "run_review"
  | "generate_rewrite"
  | "accept_final";

export type FanficArtifactKey =
  | "idea"
  | "canon"
  | "plan"
  | "context"
  | "draft"
  | "review"
  | "rewriteDraft"
  | "final";

export type FanficArtifactStatus =
  | "drafted"
  | "confirmed"
  | "created"
  | "accepted";

export interface FanficArtifactRecord {
  path: string;
  status: FanficArtifactStatus;
  updatedAt: string;
}

export interface FanficHistoryRecord {
  command: FanficCommand;
  fromStatus: FanficStatus;
  toStatus: FanficStatus;
  timestamp: string;
}

export interface FanficProjectState {
  storyId: string;
  status: FanficStatus;
  revision: number;
  artifacts: Partial<Record<FanficArtifactKey, FanficArtifactRecord>>;
  history: FanficHistoryRecord[];
  createdAt: string;
  updatedAt: string;
  lastError?: string;
}

export interface FanficProjectOptions {
  rootDir?: string;
}
