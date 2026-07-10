# Career Capture Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a project-local career-capture workflow that detects commits, asks for permission, and turns approved Novel Agent improvements into evidence-backed interview cases.

**Architecture:** A deterministic TypeScript Career CLI owns pending records, Git evidence, eligibility, redaction, and the persistent career index. A non-blocking post-commit hook only records commit facts under `.git`; a project skill owns user interaction and case writing. `AGENTS.md` invokes the skill after Codex commits and before new implementation when external pending commits exist.

**Tech Stack:** TypeScript 5.9, Node.js 18+ built-ins, Vitest 4, Git CLI, Markdown project skill, POSIX shell hook.

## Global Constraints

- Git hook must never call an LLM, access the network, run tests, or fail a commit.
- No career case may be written before explicit user confirmation.
- Pending state lives under `.git/career-capture/`; committed cases live under `career-prepare/novel-agent/`.
- `career-prepare/novel-agent/index.json` is the durable deduplication source; pending state is rebuildable.
- Exclude `.env`, credentials, `downloads/**`, `novels/**`, `fanfics/**`, `materials/runs/**`, and raw model responses from model context.
- Career-only commits and `docs(career):` commits must not trigger recursive capture.
- Commands must emit stable JSON on stdout and diagnostics on stderr.
- Generated career content is never auto-committed.
- Preserve the existing untracked `docs/P0_UNIFIED_CREATION_TECHNICAL_DESIGN.md`; do not stage it in any task.

---

## File Map

### Domain and storage

- Create `src/career/types.ts`: shared records and command result types.
- Create `src/career/json-file.ts`: atomic JSON reads/writes.
- Create `src/career/pending-store.ts`: `.git` pending record persistence.
- Create `src/career/career-index.ts`: career index load, validation, decisions, and case registration.

### Git evidence and classification

- Create `src/career/git-runner.ts`: injectable Git process boundary.
- Create `src/career/commit-context.ts`: commit metadata, safe diff, related tests/docs.
- Create `src/career/redaction.ts`: secret/path/content exclusion.
- Create `src/career/eligibility.ts`: eligible/ignored/already-processed decision.

### CLI and hook

- Create `src/career/cli.ts`: testable command router.
- Create `src/career-cli.ts`: process entrypoint.
- Create `scripts/career-pending-hook.cjs`: fast hook writer using Node built-ins.
- Create `.githooks/post-commit`: non-blocking wrapper.
- Modify `package.json`: add `career` script.

### Skill and output structure

- Create `.agents/skills/career-capture/SKILL.md`: interaction and generation workflow.
- Create `.agents/skills/career-capture/references/case-template.md`: required case format.
- Create `.agents/skills/career-capture/references/interview-topic-taxonomy.md`: topic vocabulary.
- Create `career-prepare/novel-agent/README.md`: human usage and evidence policy.
- Create `career-prepare/novel-agent/index.json`: empty durable index.
- Create `career-prepare/novel-agent/topics/*.md`: topic indexes.
- Modify `AGENTS.md`: session-start and post-commit trigger rules.

### Tests

- Create `tests/career-pending-store.test.ts`.
- Create `tests/career-index.test.ts`.
- Create `tests/career-commit-context.test.ts`.
- Create `tests/career-eligibility.test.ts`.
- Create `tests/career-cli.test.ts`.
- Create `tests/career-hook.test.ts`.
- Create `tests/career-skill-files.test.ts`.
- Create `tests/career-workflow.test.ts`.

---

### Task 1: Pending Store and Durable Career Index

**Files:**
- Create: `src/career/types.ts`
- Create: `src/career/json-file.ts`
- Create: `src/career/pending-store.ts`
- Create: `src/career/career-index.ts`
- Test: `tests/career-pending-store.test.ts`
- Test: `tests/career-index.test.ts`

**Interfaces:**
- Produces: `PendingCommitRecord`, `CareerIndex`, `PendingStore`, `CareerIndexStore`, `writeJsonAtomic()`.
- Consumes: Node `fs/promises`, `path`, `crypto.randomUUID()` only.

- [ ] **Step 1: Write failing pending-store tests**

```ts
import { afterEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import path from "path";
import { PendingStore } from "../src/career/pending-store.js";

const ROOT = path.resolve(".tmp-career-pending-test");
const GIT_DIR = path.join(ROOT, ".git");

afterEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
});

describe("PendingStore", () => {
  it("writes, lists, and marks a pending commit", async () => {
    const store = new PendingStore(GIT_DIR);
    await store.write({
      commitHash: "abc123",
      branch: "main",
      subject: "Add revision engine",
      committedAt: "2026-07-10T10:00:00.000Z",
      detectedAt: "2026-07-10T10:00:01.000Z",
      status: "pending",
    });

    expect(await store.list()).toEqual([
      expect.objectContaining({ commitHash: "abc123", status: "pending" }),
    ]);

    await store.mark("abc123", "skipped", "user_declined");
    expect(await store.read("abc123")).toMatchObject({
      status: "skipped",
      reason: "user_declined",
    });
  });

  it("returns an empty list when no pending directory exists", async () => {
    expect(await new PendingStore(GIT_DIR).list()).toEqual([]);
  });
});
```

- [ ] **Step 2: Write failing career-index tests**

```ts
import { afterEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import path from "path";
import { CareerIndexStore } from "../src/career/career-index.js";

const ROOT = path.resolve(".tmp-career-index-test");

afterEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
});

describe("CareerIndexStore", () => {
  it("creates an empty index and records a skipped decision", async () => {
    const store = new CareerIndexStore(ROOT);
    expect(await store.load()).toEqual({ schemaVersion: 1, project: "novel-agent", cases: [], decisions: [] });

    await store.recordDecision({
      commitHash: "abc123",
      status: "skipped",
      decidedAt: "2026-07-10T11:00:00.000Z",
    });

    expect((await store.load()).decisions).toEqual([
      expect.objectContaining({ commitHash: "abc123", status: "skipped" }),
    ]);
  });

  it("rejects a malformed existing index", async () => {
    const dir = path.join(ROOT, "career-prepare", "novel-agent");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "index.json"), JSON.stringify({ schemaVersion: 99 }), "utf-8");
    await expect(new CareerIndexStore(ROOT).load()).rejects.toThrow(/Invalid career index/);
  });
});
```

- [ ] **Step 3: Run the tests and verify they fail**

Run:

```bash
npx vitest run tests/career-pending-store.test.ts tests/career-index.test.ts
```

Expected: FAIL because the career modules do not exist.

- [ ] **Step 4: Implement shared types**

Create `src/career/types.ts` with these exact public contracts:

```ts
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
```

- [ ] **Step 5: Implement atomic JSON persistence**

Create `src/career/json-file.ts`:

```ts
import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

export async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf-8")) as T;
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await fs.rename(tempPath, filePath);
}
```

- [ ] **Step 6: Implement `PendingStore`**

Create `src/career/pending-store.ts` with:

```ts
import fs from "fs/promises";
import path from "path";
import { readJsonFile, writeJsonAtomic } from "./json-file.js";
import type { PendingCommitRecord, PendingStatus } from "./types.js";

export class PendingStore {
  readonly pendingDir: string;

  constructor(gitDir: string) {
    this.pendingDir = path.join(gitDir, "career-capture", "pending");
  }

  async list(): Promise<PendingCommitRecord[]> {
    const names = await fs.readdir(this.pendingDir).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const records = await Promise.all(
      names.filter((name) => name.endsWith(".json")).map((name) => readJsonFile<PendingCommitRecord>(path.join(this.pendingDir, name))),
    );
    return records.sort((a, b) => b.committedAt.localeCompare(a.committedAt));
  }

  async read(commitHash: string): Promise<PendingCommitRecord | null> {
    return readJsonFile<PendingCommitRecord>(this.pathFor(commitHash)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
  }

  async write(record: PendingCommitRecord): Promise<void> {
    await writeJsonAtomic(this.pathFor(record.commitHash), record);
  }

  async mark(commitHash: string, status: PendingStatus, reason?: string, caseId?: string): Promise<PendingCommitRecord> {
    const current = await this.read(commitHash);
    if (!current) throw new Error(`Pending commit not found: ${commitHash}`);
    const next = { ...current, status, reason, caseId };
    await this.write(next);
    return next;
  }

  private pathFor(commitHash: string): string {
    if (!/^[a-f0-9]{6,64}$/i.test(commitHash)) throw new Error("Invalid commit hash");
    return path.join(this.pendingDir, `${commitHash}.json`);
  }
}
```

- [ ] **Step 7: Implement `CareerIndexStore`**

Create `src/career/career-index.ts`. It must export:

```ts
export class CareerIndexStore {
  constructor(rootDir: string);
  load(): Promise<CareerIndex>;
  save(index: CareerIndex): Promise<void>;
  hasDecision(commitHash: string): Promise<boolean>;
  recordDecision(decision: CareerDecision): Promise<void>;
  registerCase(entry: CareerCaseIndexEntry): Promise<void>;
}
```

Implementation rules:

- Store at `<rootDir>/career-prepare/novel-agent/index.json`.
- Return a structured clone of `EMPTY_CAREER_INDEX` when absent.
- Accept only `schemaVersion === 1`, `project === "novel-agent"`, and array `cases/decisions`; otherwise throw `Invalid career index`.
- `recordDecision()` replaces an existing decision for the same hash.
- `registerCase()` replaces an existing case with the same `caseId`, then records every `commitHash` as `captured`.
- Persist through `writeJsonAtomic()`.

- [ ] **Step 8: Run focused and full tests**

Run:

```bash
npx vitest run tests/career-pending-store.test.ts tests/career-index.test.ts
npm run typecheck
```

Expected: both test files pass and TypeScript exits 0.

- [ ] **Step 9: Commit Task 1**

```bash
git add src/career/types.ts src/career/json-file.ts src/career/pending-store.ts src/career/career-index.ts tests/career-pending-store.test.ts tests/career-index.test.ts
git commit -m "feat: add career capture state stores"
```

After the commit, do not run career capture yet because the skill does not exist until Task 5.

---

### Task 2: Safe Git Context, Redaction, and Eligibility

**Files:**
- Create: `src/career/git-runner.ts`
- Create: `src/career/commit-context.ts`
- Create: `src/career/redaction.ts`
- Create: `src/career/eligibility.ts`
- Modify: `src/career/types.ts`
- Test: `tests/career-commit-context.test.ts`
- Test: `tests/career-eligibility.test.ts`

**Interfaces:**
- Consumes: `CareerIndex`, commit hash, repository root.
- Produces: `GitRunner`, `CommitContext`, `loadCommitContext()`, `redactSensitiveText()`, `classifyCommit()`.

- [ ] **Step 1: Add context and eligibility contracts to `types.ts`**

```ts
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
```

- [ ] **Step 2: Write failing context tests**

Create `tests/career-commit-context.test.ts` using an injected runner:

```ts
import { describe, expect, it } from "vitest";
import { loadCommitContext } from "../src/career/commit-context.js";
import type { GitRunner } from "../src/career/git-runner.js";

describe("loadCommitContext", () => {
  it("excludes novel and material content while keeping source and test evidence", async () => {
    const calls: string[][] = [];
    const runner: GitRunner = async (args) => {
      calls.push(args);
      const key = args.slice(0, 2).join(" ");
      if (key === "show -s") return "abc123\u0000parent1\u0000main\u0000Add workflow\u0000Body\u00002026-07-10T00:00:00Z";
      if (key === "diff-tree --no-commit-id") return "M\tsrc/fanfic/orchestrator.ts\nA\ttests/fanfic-orchestrator.test.ts\nM\tnovels/demo/001.md\nM\tmaterials/runs/book/raw-response.txt";
      if (key === "show --stat") return "4 files changed";
      if (args[0] === "show" && args.includes("--format=")) return "safe diff sk-test_secret";
      throw new Error(`Unexpected git args: ${args.join(" ")}`);
    };

    const context = await loadCommitContext("abc123", { rootDir: "/repo", runner });
    expect(context.excludedPaths).toEqual(["novels/demo/001.md", "materials/runs/book/raw-response.txt"]);
    expect(context.safeDiff).toContain("[REDACTED_SECRET]");
    expect(context.safeDiff).not.toContain("sk-test_secret");
    expect(context.relatedTests).toEqual(["tests/fanfic-orchestrator.test.ts"]);
    expect(calls.at(-1)).toContain("src/fanfic/orchestrator.ts");
    expect(calls.at(-1)).not.toContain("novels/demo/001.md");
  });
});
```

- [ ] **Step 3: Write failing eligibility tests**

Create `tests/career-eligibility.test.ts`:

```ts
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
    const processed = { ...index, decisions: [{ commitHash: "abc123", status: "skipped" as const, decidedAt: "2026-07-10T00:00:00Z" }] };
    expect(classifyCommit(base, processed)).toEqual({ eligible: false, reason: "already_processed" });
  });
});
```

- [ ] **Step 4: Run tests and verify failure**

Run:

```bash
npx vitest run tests/career-commit-context.test.ts tests/career-eligibility.test.ts
```

Expected: FAIL because the modules and added types do not exist.

- [ ] **Step 5: Implement the Git boundary**

Create `src/career/git-runner.ts`:

```ts
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";

const execFileAsync = promisify(execFile);

export type GitRunner = (args: string[], cwd: string) => Promise<string>;

export const runGit: GitRunner = async (args, cwd) => {
  const result = await execFileAsync("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 });
  return result.stdout.trimEnd();
};

export async function resolveGitDir(rootDir: string, runner: GitRunner = runGit): Promise<string> {
  const raw = await runner(["rev-parse", "--git-dir"], rootDir);
  return path.isAbsolute(raw) ? raw : path.resolve(rootDir, raw);
}
```

Add a test that returns `.git` and another that returns an absolute Git directory, asserting the first resolves under `rootDir` and the second is unchanged.

- [ ] **Step 6: Implement redaction and excluded-path policy**

Create `src/career/redaction.ts`:

```ts
const EXCLUDED_PREFIXES = ["downloads/", "novels/", "fanfics/", "materials/runs/"];
const EXCLUDED_NAMES = new Set([".env"]);

export function isExcludedEvidencePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return EXCLUDED_NAMES.has(normalized) ||
    EXCLUDED_PREFIXES.some((prefix) => normalized.startsWith(prefix)) ||
    /(^|\/)(raw-response|model-response)\.(txt|json|md)$/i.test(normalized);
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(/\b(?:sk|api)[-_][A-Za-z0-9_-]{8,}\b/g, "[REDACTED_SECRET]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/\/(?:Users|home)\/[^/\s]+/g, "/[REDACTED_HOME]");
}
```

- [ ] **Step 7: Implement commit context loading**

Create `src/career/commit-context.ts` exporting:

```ts
export async function loadCommitContext(
  commitHash: string,
  options: { rootDir: string; runner?: GitRunner },
): Promise<CommitContext>;
```

Implementation must issue these Git calls through the injected runner:

```ts
await runner(["show", "-s", "--format=%H%x00%P%x00%D%x00%s%x00%b%x00%cI", commitHash], rootDir);
await runner(["diff-tree", "--no-commit-id", "--name-status", "-r", commitHash], rootDir);
await runner(["show", "--stat", "--oneline", "--format=", commitHash], rootDir);
await runner(["show", "--format=", "--unified=80", commitHash, "--", ...safePaths], rootDir);
```

Parse NUL metadata into the public contract, use the first parent hash or `null`, derive `relatedTests` from `tests/**/*.test.ts`, derive `relatedDocs` from `docs/**/*.md`, exclude paths before requesting the diff, and pass the diff through `redactSensitiveText()`.

- [ ] **Step 8: Implement deterministic eligibility**

Create `src/career/eligibility.ts`:

```ts
import type { CareerIndex, CommitContext, EligibilityResult } from "./types.js";

export function classifyCommit(context: CommitContext, index: CareerIndex): EligibilityResult {
  if (index.decisions.some((item) => item.commitHash === context.commitHash) ||
      index.cases.some((item) => item.commitHashes.includes(context.commitHash))) {
    return { eligible: false, reason: "already_processed" };
  }
  if (context.subject.startsWith("docs(career):")) return { eligible: false, reason: "career_only" };
  if (context.files.length > 0 && context.files.every((item) => item.path.startsWith("career-prepare/novel-agent/"))) {
    return { eligible: false, reason: "career_only" };
  }
  if (context.files.some((item) => item.path.startsWith("src/") || item.path.startsWith("tests/") || item.path === "package.json" || item.path === "AGENTS.md")) {
    return { eligible: true, reason: "engineering_change" };
  }
  if (context.files.some((item) => item.path.startsWith("docs/") && item.path.endsWith(".md"))) {
    return { eligible: true, reason: "design_change" };
  }
  return { eligible: false, reason: "trivial_change" };
}
```

- [ ] **Step 9: Run focused and full checks**

Run:

```bash
npx vitest run tests/career-commit-context.test.ts tests/career-eligibility.test.ts
npm run typecheck
```

Expected: PASS and exit 0.

- [ ] **Step 10: Commit Task 2**

```bash
git add src/career/types.ts src/career/git-runner.ts src/career/commit-context.ts src/career/redaction.ts src/career/eligibility.ts tests/career-commit-context.test.ts tests/career-eligibility.test.ts
git commit -m "feat: collect safe career commit evidence"
```

---

### Task 3: Stable JSON Career CLI

**Files:**
- Create: `src/career/cli.ts`
- Create: `src/career/case-metadata.ts`
- Create: `src/career-cli.ts`
- Modify: `package.json`
- Test: `tests/career-cli.test.ts`

**Interfaces:**
- Consumes: `PendingStore`, `CareerIndexStore`, `loadCommitContext()`, `classifyCommit()`, `GitRunner`.
- Produces: `runCareerCli(args, dependencies)`, `npm run career -- <command>`, stable JSON response envelopes.

- [ ] **Step 1: Write failing CLI tests**

Create `tests/career-cli.test.ts` around the exported function, not process output:

```ts
import { afterEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import path from "path";
import { runCareerCli } from "../src/career/cli.js";
import { PendingStore } from "../src/career/pending-store.js";

const ROOT = path.resolve(".tmp-career-cli-test");
const GIT_DIR = path.join(ROOT, ".git");

afterEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
});

describe("runCareerCli", () => {
  it("lists only eligible pending commits", async () => {
    const pending = new PendingStore(GIT_DIR);
    await pending.write({ commitHash: "abc123", branch: "main", subject: "Add engine", committedAt: "2026-07-10T00:00:00Z", detectedAt: "2026-07-10T00:00:01Z", status: "pending" });
    const result = await runCareerCli(["status"], {
      rootDir: ROOT,
      gitDir: GIT_DIR,
      loadContext: async () => ({
        commitHash: "abc123", parentHash: "p", branch: "main", subject: "Add engine", body: "", committedAt: "2026-07-10T00:00:00Z",
        files: [{ status: "M", path: "src/main.ts" }], diffStat: "1 file", safeDiff: "diff", relatedTests: [], relatedDocs: [], excludedPaths: [],
      }),
    });
    expect(result).toMatchObject({ ok: true, command: "status", pending: [{ commitHash: "abc123", eligibility: { eligible: true } }] });
  });

  it("marks a commit skipped in pending and the durable index", async () => {
    const pending = new PendingStore(GIT_DIR);
    await pending.write({ commitHash: "abc123", branch: "main", subject: "Add engine", committedAt: "2026-07-10T00:00:00Z", detectedAt: "2026-07-10T00:00:01Z", status: "pending" });
    await runCareerCli(["mark", "--commit", "abc123", "--status", "skipped"], { rootDir: ROOT, gitDir: GIT_DIR, now: () => "2026-07-10T02:00:00Z" });
    expect(await pending.read("abc123")).toMatchObject({ status: "skipped" });
    const index = JSON.parse(await fs.readFile(path.join(ROOT, "career-prepare", "novel-agent", "index.json"), "utf-8"));
    expect(index.decisions).toContainEqual(expect.objectContaining({ commitHash: "abc123", status: "skipped" }));
  });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
npx vitest run tests/career-cli.test.ts
```

Expected: FAIL because `src/career/cli.ts` does not exist.

- [ ] **Step 3: Implement CLI dependency and response contracts**

At the bottom of `src/career/types.ts`, add:

```ts
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
```

- [ ] **Step 4: Implement case metadata parsing**

Create `src/career/case-metadata.ts` exporting:

```ts
export interface CareerCaseMetadata {
  caseId: string;
  title: string;
  commitHashes: string[];
  topics: string[];
  evidenceStatus: "complete" | "needs_metrics" | "needs_review";
  createdAt: string;
  updatedAt: string;
}

export async function loadCaseMetadata(rootDir: string, caseId: string): Promise<CareerCaseMetadata>;
```

The case file path is `career-prepare/novel-agent/cases/<caseId>.md`. Parse the opening YAML-like frontmatter without adding a YAML dependency. Accept one scalar per line plus JSON arrays for `commitHashes` and `topics`; reject missing fields with `Invalid career case metadata`.

- [ ] **Step 5: Implement `runCareerCli()`**

Create `src/career/cli.ts` with this public signature:

```ts
export async function runCareerCli(
  args: string[],
  dependencies: CareerCliDependencies = { rootDir: process.cwd() },
): Promise<CareerCliResult>;
```

Implement these exact behaviors:

- Resolve `gitDir` from dependencies or `resolveGitDir()`.
- `status`: load pending records whose status is `pending` or `deferred`, load context, classify, mark deterministic ignored reasons in both stores, and return only records still eligible.
- `context --commit`: return `loadCommitContext()`.
- `mark --status skipped|deferred|ignored`: update pending; persist skipped/ignored decisions, but do not persist deferred.
- `capture --commit --case`: read the completed case metadata, register/replace the case in index, mark the commit captured.
- `merge --commit --case`: require the case metadata to include the commit hash, replace the case entry, and mark captured.
- `rebuild-pending`: read the last 50 non-merge commits with `git log --format=%H%x00%D%x00%s%x00%cI -n 50`, then create pending records for hashes absent from pending and index.
- Unknown commands or missing flags throw concise errors; the process entrypoint maps them to `{ ok:false, error:{ code:"invalid_command", message } }`.

- [ ] **Step 6: Implement the process entrypoint**

Create `src/career-cli.ts`:

```ts
import { runCareerCli } from "./career/cli.js";

runCareerCli(process.argv.slice(2), { rootDir: process.cwd() })
  .then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  })
  .catch((error) => {
    process.stdout.write(`${JSON.stringify({ ok: false, error: { code: "career_command_failed", message: error instanceof Error ? error.message : String(error) } })}\n`);
    process.exitCode = 1;
  });
```

Modify `package.json` scripts:

```json
"career": "tsx src/career-cli.ts"
```

- [ ] **Step 7: Extend CLI tests for context, rebuild, capture, and idempotency**

Add tests that assert:

```ts
expect((await runCareerCli(["rebuild-pending"], deps)).created).toEqual(["abc123"]);
expect((await runCareerCli(["rebuild-pending"], deps)).created).toEqual([]);
expect(await runCareerCli(["context", "--commit", "abc123"], deps)).toMatchObject({ ok: true, command: "context" });
expect(await runCareerCli(["capture", "--commit", "abc123", "--case", "2026-07-10-agent-loop"], deps)).toMatchObject({ status: "captured" });
```

The test must write a complete case file using the frontmatter contract before calling `capture`.

- [ ] **Step 8: Run checks**

Run:

```bash
npx vitest run tests/career-cli.test.ts
npm run typecheck
```

Expected: PASS and exit 0.

- [ ] **Step 9: Commit Task 3**

```bash
git add src/career/types.ts src/career/cli.ts src/career/case-metadata.ts src/career-cli.ts package.json tests/career-cli.test.ts
git commit -m "feat: add career capture CLI"
```

---

### Task 4: Non-Blocking Post-Commit Hook and Installation Doctor

**Files:**
- Create: `scripts/career-pending-hook.cjs`
- Create: `.githooks/post-commit`
- Modify: `src/career/cli.ts`
- Test: `tests/career-hook.test.ts`
- Modify: `tests/career-cli.test.ts`

**Interfaces:**
- Consumes: Git executable, repository root.
- Produces: pending JSON on every external commit, `install-hook`, and `doctor` commands.

- [ ] **Step 1: Write failing hook integration test**

Create `tests/career-hook.test.ts` using a temporary repository:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(".tmp-career-hook-test");

afterEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
});

describe("career post-commit hook", () => {
  it("records a pending commit without changing commit success", async () => {
    await fs.mkdir(path.join(ROOT, ".githooks"), { recursive: true });
    await fs.mkdir(path.join(ROOT, "scripts"), { recursive: true });
    await fs.copyFile(path.resolve(".githooks/post-commit"), path.join(ROOT, ".githooks", "post-commit"));
    await fs.copyFile(path.resolve("scripts/career-pending-hook.cjs"), path.join(ROOT, "scripts", "career-pending-hook.cjs"));
    await fs.chmod(path.join(ROOT, ".githooks", "post-commit"), 0o755);
    await execFileAsync("git", ["init"], { cwd: ROOT });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: ROOT });
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: ROOT });
    await execFileAsync("git", ["config", "core.hooksPath", ".githooks"], { cwd: ROOT });
    await fs.writeFile(path.join(ROOT, "a.txt"), "a", "utf-8");
    await execFileAsync("git", ["add", "a.txt"], { cwd: ROOT });
    await execFileAsync("git", ["commit", "-m", "Add a"], { cwd: ROOT });
    const hash = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: ROOT })).stdout.trim();
    const record = JSON.parse(await fs.readFile(path.join(ROOT, ".git", "career-capture", "pending", `${hash}.json`), "utf-8"));
    expect(record).toMatchObject({ commitHash: hash, subject: "Add a", status: "pending" });
  });
});
```

- [ ] **Step 2: Run the hook test and verify failure**

Run:

```bash
npx vitest run tests/career-hook.test.ts
```

Expected: FAIL because hook files do not exist.

- [ ] **Step 3: Implement the Node hook writer**

Create `scripts/career-pending-hook.cjs` as a standalone CommonJS script:

```js
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function gitOptional(root, args, fallback) {
  try {
    return git(root, args);
  } catch {
    return fallback;
  }
}

function main() {
  const root = process.argv[2];
  if (!root) return;
  const rawGitDir = git(root, ["rev-parse", "--git-dir"]);
  const gitDir = path.isAbsolute(rawGitDir) ? rawGitDir : path.resolve(root, rawGitDir);
  const commitHash = git(root, ["rev-parse", "HEAD"]);
  const branch = gitOptional(root, ["symbolic-ref", "--short", "-q", "HEAD"], "detached");
  const subject = git(root, ["log", "-1", "--format=%s"]);
  const committedAt = git(root, ["log", "-1", "--format=%cI"]);
  const pendingDir = path.join(gitDir, "career-capture", "pending");
  const target = path.join(pendingDir, `${commitHash}.json`);
  if (fs.existsSync(target)) return;
  fs.mkdirSync(pendingDir, { recursive: true });
  const temp = path.join(pendingDir, `.${commitHash}.${process.pid}.tmp`);
  fs.writeFileSync(temp, `${JSON.stringify({ commitHash, branch, subject, committedAt, detectedAt: new Date().toISOString(), status: "pending" }, null, 2)}\n`, "utf8");
  fs.renameSync(temp, target);
}

try {
  main();
} catch (error) {
  process.stderr.write(`[career-capture] ${error instanceof Error ? error.message : String(error)}\n`);
}
```


- [ ] **Step 4: Implement the shell wrapper**

Create `.githooks/post-commit`:

```sh
#!/bin/sh
repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
node "$repo_root/scripts/career-pending-hook.cjs" "$repo_root" || true
exit 0
```

Then run:

```bash
chmod +x .githooks/post-commit
```

- [ ] **Step 5: Add `install-hook` and `doctor` CLI commands**

In `runCareerCli()`:

- `install-hook` runs `git config core.hooksPath .githooks` through `GitRunner`, verifies `.githooks/post-commit` exists, and returns `{ ok:true, command:"install-hook", hooksPath:".githooks" }`.
- `doctor` reads `git config --get core.hooksPath`, checks the hook with `fs.stat()`, loads pending count, and returns the exact `doctor` result contract.

Extend `tests/career-cli.test.ts` with an injected runner asserting the config command and both healthy/unhealthy doctor outputs.

- [ ] **Step 6: Run hook and CLI tests**

Run:

```bash
npx vitest run tests/career-hook.test.ts tests/career-cli.test.ts
npm run typecheck
```

Expected: PASS and exit 0.

- [ ] **Step 7: Commit Task 4**

```bash
git add .githooks/post-commit scripts/career-pending-hook.cjs src/career/cli.ts tests/career-hook.test.ts tests/career-cli.test.ts
git commit -m "feat: detect commits for career capture"
```

---

### Task 5: Career Repository, Project Skill, and Workspace Rules

**Files:**
- Create: `.agents/skills/career-capture/SKILL.md`
- Create: `.agents/skills/career-capture/references/case-template.md`
- Create: `.agents/skills/career-capture/references/interview-topic-taxonomy.md`
- Create: `career-prepare/novel-agent/README.md`
- Create: `career-prepare/novel-agent/index.json`
- Create: `career-prepare/novel-agent/topics/state-machine.md`
- Create: `career-prepare/novel-agent/topics/context-engineering.md`
- Create: `career-prepare/novel-agent/topics/observability.md`
- Create: `career-prepare/novel-agent/topics/evaluation.md`
- Create: `career-prepare/novel-agent/topics/human-in-the-loop.md`
- Create: `career-prepare/novel-agent/topics/reliability.md`
- Modify: `AGENTS.md`
- Test: `tests/career-skill-files.test.ts`

**Interfaces:**
- Consumes: stable Career CLI JSON.
- Produces: project skill, required interaction, case template, durable index, topic indexes.

- [ ] **Step 1: Write failing skill-file tests**

Create `tests/career-skill-files.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import fs from "fs/promises";

describe("career capture project files", () => {
  it("defines a project skill with explicit confirmation and CLI usage", async () => {
    const skill = await fs.readFile(".agents/skills/career-capture/SKILL.md", "utf-8");
    expect(skill).toContain("name: career-capture");
    expect(skill).toContain("npm run career -- status");
    expect(skill).toContain("生成 / 跳过 / 稍后 / 合并");
    expect(skill).toContain("未经用户确认，不得创建案例");
  });

  it("adds session-start and post-commit rules without bypassing the novel workflow", async () => {
    const agents = await fs.readFile("AGENTS.md", "utf-8");
    expect(agents).toContain("## Career Capture");
    expect(agents).toContain("after a successful commit");
    expect(agents).toContain("before beginning a new implementation task");
  });

  it("initializes a valid empty career index", async () => {
    const index = JSON.parse(await fs.readFile("career-prepare/novel-agent/index.json", "utf-8"));
    expect(index).toEqual({ schemaVersion: 1, project: "novel-agent", cases: [], decisions: [] });
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npx vitest run tests/career-skill-files.test.ts
```

Expected: FAIL because the skill and career directory do not exist.

- [ ] **Step 3: Create the case template and taxonomy**

`case-template.md` must define this exact frontmatter contract:

```md
---
caseId: {{CASE_ID}}
title: {{TITLE}}
commitHashes: {{COMMIT_HASHES_JSON}}
topics: {{TOPICS_JSON}}
evidenceStatus: {{EVIDENCE_STATUS}}
createdAt: {{CREATED_AT}}
updatedAt: {{UPDATED_AT}}
---

# {{TITLE}}

## 一句话背景

## 遇到的困难

## 为什么这是 Agent 工程问题

## 约束与失败模式

## 方案比较

## 最终决策

## 关键实现

## 测试与证据

## 最终效果

### 已验证

### 尚未验证

### 下一步测量

## 设计取舍与遗留问题

## 面试知识点

## 追问与回答要点

## 60 秒回答

## 3 分钟回答
```

The taxonomy must define stable slugs and descriptions for: `orchestration`, `state-machine`, `context-engineering`, `memory`, `tool-use`, `human-in-the-loop`, `evaluation`, `observability`, `reliability`, `security`, `model-routing`, and `testing`.

- [ ] **Step 4: Create the project skill**

The complete `SKILL.md` workflow must:

1. Run `npm run career -- status` and parse JSON.
2. Stop silently when pending is empty.
3. Select only the newest eligible record.
4. Run `npm run career -- context --commit <hash>`.
5. Summarize subject, topics, changed source/test counts, and available verification evidence.
6. Ask exactly one question offering `生成 / 跳过 / 稍后 / 合并`.
7. On `跳过`, run `mark --status skipped`.
8. On `稍后`, run `mark --status deferred`.
9. On `合并`, ask for the target case, update the case content/frontmatter, then run `merge`.
10. On `生成`, copy the case template, fill every section with evidence-backed content, write one case file, update topic indexes, then run `capture`.
11. Mark unsupported outcome claims as `needs_metrics` or `needs_review`.
12. Never read excluded content paths and never auto-commit.

The skill frontmatter is:

```yaml
---
name: career-capture
description: Ask whether a completed Novel Agent commit should be distilled into an evidence-backed Agent engineering interview case, then create, skip, defer, or merge the case using the local Career CLI.
---
```

- [ ] **Step 5: Initialize career output files**

Create `career-prepare/novel-agent/index.json` exactly as:

```json
{
  "schemaVersion": 1,
  "project": "novel-agent",
  "cases": [],
  "decisions": []
}
```

The README documents the four user choices, evidence policy, no-fabricated-metrics rule, and hook installation command. Each topic file starts with a title, one-sentence definition, and an empty `## Cases` section.

- [ ] **Step 6: Update `AGENTS.md`**

Append this project rule, preserving the existing Novel Agent workflow and skill limits:

```md
## Career Capture

- Before beginning a new implementation task, run `npm run career -- status`. If it returns an eligible pending commit, invoke the project `career-capture` skill and ask the user before implementation continues.
- After a successful commit, invoke the project `career-capture` skill for that commit before declaring the task complete.
- Never generate a career case without explicit user confirmation.
- Do not trigger capture for commits that only change `career-prepare/novel-agent/**` or whose subject starts with `docs(career):`.
- Career capture is a documentation side workflow; it must not bypass or alter the Novel Agent story workflow.
```

- [ ] **Step 7: Run file tests and typecheck**

Run:

```bash
npx vitest run tests/career-skill-files.test.ts
npm run typecheck
```

Expected: PASS and exit 0.

- [ ] **Step 8: Commit Task 5**

```bash
git add .agents/skills/career-capture AGENTS.md career-prepare/novel-agent tests/career-skill-files.test.ts
git commit -m "feat: add career capture project skill"
```

Immediately after this commit, invoke the newly installed skill. The commit itself is eligible because it implements Agent workflow infrastructure; ask the user whether to capture it. Do not generate the case without confirmation.

---

### Task 6: End-to-End Workflow, Hook Doctor, and Self-Hosting Verification

**Files:**
- Create: `tests/career-workflow.test.ts`
- Modify: `career-prepare/novel-agent/README.md`
- Modify: `docs/superpowers/specs/2026-07-10-career-capture-skill-design.md` only if implementation behavior differs from the approved contract

**Interfaces:**
- Consumes: all Career CLI commands, hook, skill files, index.
- Produces: a verified end-to-end local workflow and installation instructions.

- [ ] **Step 1: Write the end-to-end failing test**

Create `tests/career-workflow.test.ts` with a temporary Git repository and invoke the real CLI function:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { runCareerCli } from "../src/career/cli.js";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(".tmp-career-workflow-test");

afterEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
});

describe("career capture workflow", () => {
  it("detects, captures, deduplicates, and ignores career-only commits", async () => {
    await fs.mkdir(path.join(ROOT, "src"), { recursive: true });
    await execFileAsync("git", ["init"], { cwd: ROOT });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: ROOT });
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: ROOT });
    await fs.writeFile(path.join(ROOT, "src", "agent.ts"), "export const value = 1;\n", "utf-8");
    await execFileAsync("git", ["add", "src/agent.ts"], { cwd: ROOT });
    await execFileAsync("git", ["commit", "-m", "Add agent state"], { cwd: ROOT });
    const hash = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: ROOT })).stdout.trim();

    const rebuilt = await runCareerCli(["rebuild-pending"], { rootDir: ROOT });
    expect(rebuilt).toMatchObject({ command: "rebuild-pending", created: [hash] });

    const status = await runCareerCli(["status"], { rootDir: ROOT });
    expect(status).toMatchObject({ command: "status", pending: [{ commitHash: hash, eligibility: { eligible: true } }] });

    const caseId = "2026-07-10-agent-state";
    const caseDir = path.join(ROOT, "career-prepare", "novel-agent", "cases");
    await fs.mkdir(caseDir, { recursive: true });
    await fs.writeFile(path.join(caseDir, `${caseId}.md`), [
      "---", `caseId: ${caseId}`, "title: Agent State", `commitHashes: [\"${hash}\"]`, "topics: [\"state-machine\"]",
      "evidenceStatus: complete", "createdAt: 2026-07-10T00:00:00Z", "updatedAt: 2026-07-10T00:00:00Z", "---", "", "# Agent State", "",
    ].join("\n"), "utf-8");

    expect(await runCareerCli(["capture", "--commit", hash, "--case", caseId], { rootDir: ROOT }))
      .toMatchObject({ status: "captured", caseId });
    expect((await runCareerCli(["status"], { rootDir: ROOT })).pending).toEqual([]);
    expect((await runCareerCli(["rebuild-pending"], { rootDir: ROOT })).created).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the workflow test**

Run:

```bash
npx vitest run tests/career-workflow.test.ts
```

Expected: PASS if Tasks 1–5 meet the contract. If it fails, fix the narrow contract mismatch in the owning module and rerun that module's focused tests before rerunning this test.

- [ ] **Step 3: Add recovery and non-blocking assertions**

Extend the workflow test with exact assertions:

- Delete `.git/career-capture/pending`, run `rebuild-pending`, and assert captured hashes are not recreated.
- Add a `docs(career):` commit, rebuild, run status, and assert it is ignored.
- Add a commit changing only `career-prepare/novel-agent/cases/x.md`, rebuild, run status, and assert it is ignored.
- Replace the hook helper temporarily with a script that exits 1, create a commit, and assert `git commit` still exits 0.
- Corrupt `index.json`, run status, and assert the command fails without changing pending records.

- [ ] **Step 4: Install and diagnose the hook in the real repository**

Run:

```bash
npm run career -- install-hook
npm run career -- doctor
```

Expected JSON fields:

```json
{"ok":true,"command":"doctor","configured":true,"hookExists":true}
```

This command changes only local `.git/config`; it must not modify tracked files.

- [ ] **Step 5: Run the full verification suite**

Run:

```bash
npm run check
git diff --check
```

Expected:

- TypeScript exits 0.
- All existing and new Vitest files pass.
- `git diff --check` emits no output.

- [ ] **Step 6: Update README with verified commands**

Add only commands actually verified in Step 4 and record that external commits are discovered on the next Codex session, not through a real-time AI callback.

- [ ] **Step 7: Commit Task 6**

```bash
git add tests/career-workflow.test.ts career-prepare/novel-agent/README.md docs/superpowers/specs/2026-07-10-career-capture-skill-design.md
git commit -m "test: verify career capture workflow"
```

Invoke `career-capture` after the commit. This is the self-hosting acceptance point: status must detect the commit and ask the user exactly once.

---

## Final Acceptance Checklist

- [ ] Codex-created commits trigger the project skill after successful commit.
- [ ] External commits create pending records without slowing or failing Git.
- [ ] `rebuild-pending` recovers when the hook was not installed.
- [ ] `status` returns only eligible, unprocessed commits as stable JSON.
- [ ] Generate, skip, defer, and merge have durable, deduplicated state.
- [ ] Career-only commits do not recurse.
- [ ] Excluded novel/material/model content never enters `CommitContext.safeDiff`.
- [ ] Cases cannot be registered without complete frontmatter.
- [ ] No unverified outcome is presented as measured impact.
- [ ] `npm run check` and `git diff --check` pass.
- [ ] Existing untracked P0 design remains untouched unless separately authorized.
