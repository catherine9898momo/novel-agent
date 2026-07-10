import type { CareerIndex, CommitContext, EligibilityResult } from "./types.js";

export function classifyCommit(context: CommitContext, index: CareerIndex): EligibilityResult {
  if (index.decisions.some((item) => item.commitHash === context.commitHash)
      || index.cases.some((item) => item.commitHashes.includes(context.commitHash))) {
    return { eligible: false, reason: "already_processed" };
  }
  if (context.subject.startsWith("docs(career):")) return { eligible: false, reason: "career_only" };
  if (context.files.length > 0
      && context.files.every((item) => item.path.startsWith("career-prepare/novel-agent/"))) {
    return { eligible: false, reason: "career_only" };
  }
  if (context.files.some((item) => item.path.startsWith("src/")
      || item.path.startsWith("tests/")
      || item.path === "package.json"
      || item.path === "AGENTS.md")) {
    return { eligible: true, reason: "engineering_change" };
  }
  if (context.files.some((item) => item.path.startsWith("docs/") && item.path.endsWith(".md"))) {
    return { eligible: true, reason: "design_change" };
  }
  return { eligible: false, reason: "trivial_change" };
}
