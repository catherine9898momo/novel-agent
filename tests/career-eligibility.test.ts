import { describe, expect, it } from "vitest";
import { classifyCommit } from "../src/career/eligibility.js";
import type { CareerIndex, CommitContext } from "../src/career/types.js";

const index: CareerIndex = { schemaVersion: 1, project: "novel-agent", cases: [], decisions: [] };
const base: CommitContext = {
  commitHash: "abc123",
  parentHash: "parent1",
  branch: "main",
  subject: "Add workflow",
  body: "",
  committedAt: "2026-07-10T00:00:00Z",
  files: [],
  diffStat: "",
  safeDiff: "",
  relatedTests: [],
  relatedDocs: [],
  excludedPaths: [],
};

describe("classifyCommit", () => {
  it("accepts source and test changes", () => {
    expect(classifyCommit({ ...base, files: [{ status: "M", path: "src/fanfic/orchestrator.ts" }] }, index))
      .toEqual({ eligible: true, reason: "engineering_change" });
  });

  it("ignores career-only changes", () => {
    expect(classifyCommit({ ...base, files: [{ status: "A", path: "career-prepare/novel-agent/cases/a.md" }] }, index))
      .toEqual({ eligible: false, reason: "career_only" });
  });

  it("ignores a previously processed commit", () => {
    const processed = {
      ...index,
      decisions: [{ commitHash: "abc123", status: "skipped" as const, decidedAt: "2026-07-10T00:00:00Z" }],
    };
    expect(classifyCommit(base, processed)).toEqual({ eligible: false, reason: "already_processed" });
  });
});
