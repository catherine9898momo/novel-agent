import { afterEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import path from "path";
import { runCareerCli } from "../src/career/cli.js";
import { PendingStore } from "../src/career/pending-store.js";

const ROOT = path.resolve(".tmp-career-cli-commands-test");
const GIT_DIR = path.join(ROOT, ".git");

afterEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
});

describe("career CLI commands", () => {
  it("returns commit context through the injected loader", async () => {
    const context = {
      commitHash: "abc123",
      parentHash: "p",
      branch: "main",
      subject: "Add engine",
      body: "",
      committedAt: "2026-07-10T00:00:00Z",
      files: [{ status: "M", path: "src/main.ts" }],
      diffStat: "1 file",
      safeDiff: "safe diff",
      relatedTests: [],
      relatedDocs: [],
      excludedPaths: [],
    };
    const result = await runCareerCli(["context", "--commit", "abc123"], {
      rootDir: ROOT,
      gitDir: GIT_DIR,
      loadContext: async () => context,
    });
    expect(result).toEqual({ ok: true, command: "context", context });
  });

  it("rebuilds pending commits idempotently and honors durable decisions", async () => {
    const runner = async (args: string[]) => {
      if (args[0] === "log") return "abc123\u0000main\u0000Add engine\u00002026-07-10T00:00:00Z";
      throw new Error(`Unexpected git command: ${args.join(" ")}`);
    };
    const deps = { rootDir: ROOT, gitDir: GIT_DIR, runner, now: () => "2026-07-10T00:00:01Z" };
    expect(await runCareerCli(["rebuild-pending"], deps)).toMatchObject({ created: ["abc123"] });
    expect(await runCareerCli(["rebuild-pending"], deps)).toMatchObject({ created: [] });
    await runCareerCli(["mark", "--commit", "abc123", "--status", "skipped"], deps);
    await fs.rm(path.join(GIT_DIR, "career-capture"), { recursive: true, force: true });
    expect(await runCareerCli(["rebuild-pending"], deps)).toMatchObject({ created: [] });
  });

  it("captures a complete case and removes it from pending", async () => {
    const pending = new PendingStore(GIT_DIR);
    await pending.write({ commitHash: "abc123", branch: "main", subject: "Add engine", committedAt: "2026-07-10T00:00:00Z", detectedAt: "2026-07-10T00:00:01Z", status: "pending" });
    const caseId = "2026-07-10-agent-loop";
    const caseDir = path.join(ROOT, "career-prepare", "novel-agent", "cases");
    await fs.mkdir(caseDir, { recursive: true });
    await fs.writeFile(path.join(caseDir, `${caseId}.md`), [
      "---",
      `caseId: ${caseId}`,
      "title: Agent Loop",
      "commitHashes: [\"abc123\"]",
      "topics: [\"orchestration\"]",
      "evidenceStatus: complete",
      "createdAt: 2026-07-10T00:00:00Z",
      "updatedAt: 2026-07-10T00:00:00Z",
      "---",
      "",
      "# Agent Loop",
    ].join("\n"), "utf-8");

    expect(await runCareerCli(["capture", "--commit", "abc123", "--case", caseId], { rootDir: ROOT, gitDir: GIT_DIR }))
      .toMatchObject({ ok: true, command: "capture", status: "captured", caseId });
    expect((await runCareerCli(["status"], { rootDir: ROOT, gitDir: GIT_DIR })).pending).toEqual([]);
  });

  it("rejects incomplete or mismatched case metadata", async () => {
    const pending = new PendingStore(GIT_DIR);
    await pending.write({ commitHash: "abc123", branch: "main", subject: "Add engine", committedAt: "2026-07-10T00:00:00Z", detectedAt: "2026-07-10T00:00:01Z", status: "pending" });
    const caseDir = path.join(ROOT, "career-prepare", "novel-agent", "cases");
    await fs.mkdir(caseDir, { recursive: true });
    await fs.writeFile(path.join(caseDir, "bad-case.md"), "---\ncaseId: bad-case\n---\n", "utf-8");
    await expect(runCareerCli(["capture", "--commit", "abc123", "--case", "bad-case"], { rootDir: ROOT, gitDir: GIT_DIR }))
      .rejects.toThrow(/Invalid career case metadata/);
  });
});
