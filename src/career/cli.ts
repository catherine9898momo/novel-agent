import type {
  CareerCaseIndexEntry,
  CareerCliDependencies,
  CareerCliResult,
  CareerIndex,
  CommitContext,
  EligibilityResult,
  PendingCommitRecord,
  PendingStatus,
} from "./types.js";
import { CareerIndexStore } from "./career-index.js";
import { loadCaseMetadata } from "./case-metadata.js";
import { loadCommitContext } from "./commit-context.js";
import { classifyCommit } from "./eligibility.js";
import { resolveGitDir, runGit, type GitRunner } from "./git-runner.js";
import { PendingStore } from "./pending-store.js";

export class CareerCliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CareerCliUsageError";
  }
}

export function isCommitUnreachableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /bad object|unknown revision|not a valid object name|ambiguous argument|invalid object name/i.test(message);
}

export async function runCareerCli(
  args: string[],
  dependencies: CareerCliDependencies = { rootDir: process.cwd() },
): Promise<CareerCliResult> {
  const rootDir = dependencies.rootDir;
  const runner = dependencies.runner ?? runGit;
  const gitDir = dependencies.gitDir ?? await resolveGitDir(rootDir, runner);
  const now = dependencies.now ?? (() => new Date().toISOString());
  const pendingStore = new PendingStore(gitDir);
  const indexStore = new CareerIndexStore(rootDir);
  const contextLoader = dependencies.loadContext ?? ((hash: string) => loadCommitContext(hash, { rootDir, runner }));
  const command = args[0];

  if (command === "status") return runStatus(pendingStore, indexStore, contextLoader, now);
  if (command === "context") return { ok: true, command, context: await contextLoader(requiredFlag(args, "--commit")) };
  if (command === "mark") return runMark(args, pendingStore, indexStore, now);
  if (command === "capture" || command === "merge") return runCapture(command, args, rootDir, pendingStore, indexStore);
  if (command === "rebuild-pending") return runRebuildPending(pendingStore, indexStore, runner, rootDir, now);
  throw new CareerCliUsageError(`Unknown career command: ${command ?? "<missing>"}`);
}

async function runStatus(
  pendingStore: PendingStore,
  indexStore: CareerIndexStore,
  loadContext: (commitHash: string) => Promise<CommitContext>,
  now: () => string,
): Promise<CareerCliResult> {
  const index = await indexStore.load();
  const pending: Array<PendingCommitRecord & { eligibility: EligibilityResult }> = [];
  for (const record of await pendingStore.list()) {
    if (record.status !== "pending" && record.status !== "deferred") continue;
    let context: CommitContext;
    try {
      context = await loadContext(record.commitHash);
    } catch (error) {
      if (!isCommitUnreachableError(error)) throw error;
      await markIgnored(record, "commit_unreachable", pendingStore, indexStore, now);
      continue;
    }
    const eligibility = classifyCommit(context, index);
    if (eligibility.eligible) pending.push({ ...record, eligibility });
    else if (eligibility.reason === "already_processed") await reconcileProcessedRecord(record, index, pendingStore);
    else await markIgnored(record, eligibility.reason, pendingStore, indexStore, now);
  }
  return { ok: true, command: "status", pending };
}

async function runMark(args: string[], pendingStore: PendingStore, indexStore: CareerIndexStore, now: () => string): Promise<CareerCliResult> {
  const commitHash = requiredFlag(args, "--commit");
  const status = requiredFlag(args, "--status") as PendingStatus;
  if (!new Set<PendingStatus>(["skipped", "deferred", "ignored"]).has(status)) {
    throw new CareerCliUsageError("--status must be skipped, deferred, or ignored");
  }
  await pendingStore.mark(commitHash, status, `user_${status}`);
  if (status === "skipped" || status === "ignored") await indexStore.recordDecision({ commitHash, status, decidedAt: now() });
  return { ok: true, command: "mark", commitHash, status };
}

async function runCapture(
  command: "capture" | "merge",
  args: string[],
  rootDir: string,
  pendingStore: PendingStore,
  indexStore: CareerIndexStore,
): Promise<CareerCliResult> {
  const commitHash = requiredFlag(args, "--commit");
  const caseId = requiredFlag(args, "--case");
  const pending = await pendingStore.read(commitHash);
  if (!pending || (pending.status !== "pending" && pending.status !== "deferred")) {
    throw new Error(`Pending commit not available for ${command}: ${commitHash}`);
  }
  const metadata = await loadCaseMetadata(rootDir, caseId);
  if (!metadata.commitHashes.includes(commitHash)) throw new Error(`Career case ${caseId} does not include commit ${commitHash}`);
  const entry: CareerCaseIndexEntry = { ...metadata, path: `career-prepare/novel-agent/cases/${caseId}.md` };
  await indexStore.registerCase(entry);
  await pendingStore.mark(commitHash, "captured", undefined, caseId);
  return { ok: true, command, commitHash, status: "captured", caseId };
}

async function runRebuildPending(
  pendingStore: PendingStore,
  indexStore: CareerIndexStore,
  runner: GitRunner,
  rootDir: string,
  now: () => string,
): Promise<CareerCliResult> {
  const raw = await runner(["log", "--no-merges", "--format=%H%x00%D%x00%s%x00%cI", "-n", "50"], rootDir);
  const existing = new Set((await pendingStore.list()).map((record) => record.commitHash));
  const index = await indexStore.load();
  const processed = new Set([...index.decisions.map((item) => item.commitHash), ...index.cases.flatMap((item) => item.commitHashes)]);
  const created: string[] = [];
  for (const line of raw.split("\n").filter(Boolean)) {
    const [commitHash, branch, subject, committedAt] = line.split("\u0000");
    if (!commitHash || !subject || !committedAt || existing.has(commitHash) || processed.has(commitHash)) continue;
    await pendingStore.write({ commitHash, branch: branch || "detached", subject, committedAt, detectedAt: now(), status: "pending" });
    existing.add(commitHash);
    created.push(commitHash);
  }
  return { ok: true, command: "rebuild-pending", created };
}

async function markIgnored(record: PendingCommitRecord, reason: string, pendingStore: PendingStore, indexStore: CareerIndexStore, now: () => string): Promise<void> {
  await pendingStore.mark(record.commitHash, "ignored", reason);
  await indexStore.recordDecision({ commitHash: record.commitHash, status: "ignored", decidedAt: now() });
}

async function reconcileProcessedRecord(record: PendingCommitRecord, index: CareerIndex, pendingStore: PendingStore): Promise<void> {
  const decision = index.decisions.find((item) => item.commitHash === record.commitHash);
  if (decision) {
    await pendingStore.mark(record.commitHash, decision.status, "already_processed", decision.caseId);
    return;
  }
  const careerCase = index.cases.find((item) => item.commitHashes.includes(record.commitHash));
  await pendingStore.mark(record.commitHash, "captured", "already_processed", careerCase?.caseId);
}

function requiredFlag(args: string[], flag: string): string {
  const index = args.indexOf(flag);
  const value = index === -1 ? undefined : args[index + 1];
  if (!value || value.startsWith("--")) throw new CareerCliUsageError(`${flag} is required`);
  return value;
}
