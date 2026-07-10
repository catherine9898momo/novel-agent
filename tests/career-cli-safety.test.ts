import { afterEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import path from "path";
import { CareerCliUsageError, runCareerCli } from "../src/career/cli.js";
import { PendingStore } from "../src/career/pending-store.js";

const ROOT = path.resolve(".tmp-career-cli-safety-test");
const GIT_DIR = path.join(ROOT, ".git");

afterEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
});

async function writePending(): Promise<void> {
  await new PendingStore(GIT_DIR).write({
    commitHash: "abc123",
    branch: "main",
    subject: "Add engine",
    committedAt: "2026-07-10T00:00:00Z",
    detectedAt: "2026-07-10T00:00:01Z",
    status: "pending",
  });
}

describe("career CLI safety", () => {
  it("rethrows transient context failures without suppressing the commit", async () => {
    await writePending();
    await expect(runCareerCli(["status"], {
      rootDir: ROOT,
      gitDir: GIT_DIR,
      loadContext: async () => { throw new Error("EACCES temporary repository failure"); },
    })).rejects.toThrow(/EACCES/);
    expect(await new PendingStore(GIT_DIR).read("abc123")).toMatchObject({ status: "pending" });
  });

  it("marks a genuinely missing commit ignored", async () => {
    await writePending();
    expect((await runCareerCli(["status"], {
      rootDir: ROOT,
      gitDir: GIT_DIR,
      loadContext: async () => { throw new Error("fatal: bad object abc123"); },
      now: () => "2026-07-10T00:00:02Z",
    })).pending).toEqual([]);
    expect(await new PendingStore(GIT_DIR).read("abc123")).toMatchObject({ status: "ignored", reason: "commit_unreachable" });
  });

  it("does not mutate the durable index when capture has no pending record", async () => {
    const caseId = "2026-07-10-agent-loop";
    const caseDir = path.join(ROOT, "career-prepare", "novel-agent", "cases");
    await fs.mkdir(caseDir, { recursive: true });
    await fs.writeFile(path.join(caseDir, `${caseId}.md`), [
      "---", `caseId: ${caseId}`, "title: Agent Loop", "commitHashes: [\"abc123\"]",
      "topics: [\"orchestration\"]", "evidenceStatus: complete", "createdAt: 2026-07-10T00:00:00Z",
      "updatedAt: 2026-07-10T00:00:00Z", "---", "", "# Agent Loop",
    ].join("\n"), "utf-8");
    await expect(runCareerCli(["capture", "--commit", "abc123", "--case", caseId], { rootDir: ROOT, gitDir: GIT_DIR }))
      .rejects.toThrow(/Pending commit not available/);
    await expect(fs.stat(path.join(ROOT, "career-prepare", "novel-agent", "index.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("classifies unknown commands as usage errors", async () => {
    await expect(runCareerCli(["unknown"], { rootDir: ROOT, gitDir: GIT_DIR })).rejects.toBeInstanceOf(CareerCliUsageError);
  });
});
