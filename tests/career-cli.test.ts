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
    await pending.write({
      commitHash: "abc123",
      branch: "main",
      subject: "Add engine",
      committedAt: "2026-07-10T00:00:00Z",
      detectedAt: "2026-07-10T00:00:01Z",
      status: "pending",
    });

    const result = await runCareerCli(["status"], {
      rootDir: ROOT,
      gitDir: GIT_DIR,
      loadContext: async () => ({
        commitHash: "abc123",
        parentHash: "p",
        branch: "main",
        subject: "Add engine",
        body: "",
        committedAt: "2026-07-10T00:00:00Z",
        files: [{ status: "M", path: "src/main.ts" }],
        diffStat: "1 file",
        safeDiff: "diff",
        relatedTests: [],
        relatedDocs: [],
        excludedPaths: [],
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      command: "status",
      pending: [{ commitHash: "abc123", eligibility: { eligible: true } }],
    });
  });

  it("marks a commit skipped in pending and the durable index", async () => {
    const pending = new PendingStore(GIT_DIR);
    await pending.write({
      commitHash: "abc123",
      branch: "main",
      subject: "Add engine",
      committedAt: "2026-07-10T00:00:00Z",
      detectedAt: "2026-07-10T00:00:01Z",
      status: "pending",
    });

    const result = await runCareerCli(
      ["mark", "--commit", "abc123", "--status", "skipped"],
      { rootDir: ROOT, gitDir: GIT_DIR, now: () => "2026-07-10T02:00:00Z" },
    );

    expect(result).toEqual({
      ok: true,
      command: "mark",
      commitHash: "abc123",
      status: "skipped",
    });
    expect(await pending.read("abc123")).toMatchObject({ status: "skipped" });
    const index = JSON.parse(
      await fs.readFile(path.join(ROOT, "career-prepare", "novel-agent", "index.json"), "utf-8"),
    ) as { decisions: unknown[] };
    expect(index.decisions).toContainEqual(
      expect.objectContaining({ commitHash: "abc123", status: "skipped" }),
    );
  });
});
