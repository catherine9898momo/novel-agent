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

export const EMPTY_CAREER_INDEX: CareerIndex = {
  schemaVersion: 1,
  project: "novel-agent",
  cases: [],
  decisions: [],
};
