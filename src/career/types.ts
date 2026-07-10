export type PendingStatus = "pending" | "deferred" | "captured" | "skipped" | "ignored";

export interface PendingCommitRecord {
  commitHash: string;
  branch: string;
  subject: string;
  committedAt: string;
  detectedAt: string;
  status: PendingStatus;
  caseId?: string;
  reason?: string;
}

export interface CareerCaseIndexEntry {
  caseId: string;
  title: string;
  path: string;
  commitHashes: string[];
  topics: string[];
  createdAt: string;
  updatedAt: string;
  evidenceStatus: "complete" | "needs_metrics" | "needs_review";
}

export interface CareerDecision {
  commitHash: string;
  status: "captured" | "skipped" | "ignored";
  caseId?: string;
  decidedAt: string;
}

export interface CareerIndex {
  schemaVersion: 1;
  project: "novel-agent";
  cases: CareerCaseIndexEntry[];
  decisions: CareerDecision[];
}

export interface CommitFileChange {
  status: string;
  path: string;
}

export interface CommitContext {
  commitHash: string;
  parentHash: string | null;
  branch: string;
  subject: string;
  body: string;
  committedAt: string;
  files: CommitFileChange[];
  diffStat: string;
  safeDiff: string;
  relatedTests: string[];
  relatedDocs: string[];
  excludedPaths: string[];
}

export interface EligibilityResult {
  eligible: boolean;
  reason: "engineering_change" | "design_change" | "already_processed" | "career_only" | "trivial_change" | "commit_unreachable";
}

export interface CareerCliDependencies {
  rootDir: string;
  gitDir?: string;
  now?: () => string;
  runner?: import("./git-runner.js").GitRunner;
  loadContext?: (commitHash: string) => Promise<CommitContext>;
}

export type CareerCliResult =
  | { ok: true; command: "status"; pending: Array<PendingCommitRecord & { eligibility: EligibilityResult }> }
  | { ok: true; command: "context"; context: CommitContext }
  | { ok: true; command: "mark" | "capture" | "merge"; commitHash: string; status: PendingStatus; caseId?: string }
  | { ok: true; command: "rebuild-pending"; created: string[] }
  | { ok: true; command: "install-hook"; hooksPath: ".githooks" }
  | { ok: true; command: "doctor"; configured: boolean; hookExists: boolean; pendingCount: number };

export const EMPTY_CAREER_INDEX: CareerIndex = {
  schemaVersion: 1,
  project: "novel-agent",
  cases: [],
  decisions: [],
};
