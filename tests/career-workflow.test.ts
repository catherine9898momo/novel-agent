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

async function git(args: string[]): Promise<string> {
  return (await execFileAsync("git", args, { cwd: ROOT })).stdout.trim();
}

async function commitFile(relativePath: string, content: string, subject: string): Promise<string> {
  const filePath = path.join(ROOT, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
  await git(["add", relativePath]);
  await git(["commit", "-m", subject]);
  return git(["rev-parse", "HEAD"]);
}

async function snapshotPending(): Promise<Record<string, string>> {
  const pendingDir = path.join(ROOT, ".git", "career-capture", "pending");
  const names = await fs.readdir(pendingDir);
  return Object.fromEntries(
    await Promise.all(
      names.sort().map(async (name) => [name, await fs.readFile(path.join(pendingDir, name), "utf8")]),
    ),
  );
}

describe("career capture workflow", () => {
  it("recovers, captures, deduplicates, ignores career-only work, and never blocks commits", async () => {
    await fs.rm(ROOT, { recursive: true, force: true });
    await fs.mkdir(ROOT, { recursive: true });
    await execFileAsync("git", ["init"], { cwd: ROOT });
    await git(["config", "user.email", "test@example.com"]);
    await git(["config", "user.name", "Test"]);

    const sourceHash = await commitFile("src/agent.ts", "export const value = 1;\n", "Add agent state");

    expect(await runCareerCli(["rebuild-pending"], { rootDir: ROOT })).toMatchObject({
      command: "rebuild-pending",
      created: [sourceHash],
    });
    expect(await runCareerCli(["status"], { rootDir: ROOT })).toMatchObject({
      command: "status",
      pending: [{ commitHash: sourceHash, eligibility: { eligible: true } }],
    });

    const caseId = "2026-07-10-agent-state";
    const caseDir = path.join(ROOT, "career-prepare", "novel-agent", "cases");
    await fs.mkdir(caseDir, { recursive: true });
    await fs.writeFile(
      path.join(caseDir, `${caseId}.md`),
      [
        "---",
        `caseId: ${caseId}`,
        "title: Agent State",
        `commitHashes: [\"${sourceHash}\"]`,
        "topics: [\"state-machine\"]",
        "evidenceStatus: complete",
        "createdAt: 2026-07-10T00:00:00Z",
        "updatedAt: 2026-07-10T00:00:00Z",
        "---",
        "",
        "# Agent State",
        "",
      ].join("\n"),
      "utf8",
    );

    expect(
      await runCareerCli(["capture", "--commit", sourceHash, "--case", caseId], { rootDir: ROOT }),
    ).toMatchObject({ status: "captured", caseId });
    expect((await runCareerCli(["status"], { rootDir: ROOT })).pending).toEqual([]);

    await fs.rm(path.join(ROOT, ".git", "career-capture", "pending"), {
      recursive: true,
      force: true,
    });
    expect((await runCareerCli(["rebuild-pending"], { rootDir: ROOT })).created).toEqual([]);

    const docsHash = await commitFile(
      "docs/career-note.md",
      "Career documentation only.\n",
      "docs(career): document capture",
    );
    expect((await runCareerCli(["rebuild-pending"], { rootDir: ROOT })).created).toEqual([docsHash]);
    expect((await runCareerCli(["status"], { rootDir: ROOT })).pending).toEqual([]);

    const careerOnlyHash = await commitFile(
      "career-prepare/novel-agent/cases/x.md",
      "# Career-only update\n",
      "Update interview notes",
    );
    expect((await runCareerCli(["rebuild-pending"], { rootDir: ROOT })).created).toEqual([
      careerOnlyHash,
    ]);
    expect((await runCareerCli(["status"], { rootDir: ROOT })).pending).toEqual([]);

    await fs.mkdir(path.join(ROOT, ".githooks"), { recursive: true });
    await fs.mkdir(path.join(ROOT, "scripts"), { recursive: true });
    await fs.copyFile(path.resolve(".githooks/post-commit"), path.join(ROOT, ".githooks", "post-commit"));
    await fs.chmod(path.join(ROOT, ".githooks", "post-commit"), 0o755);
    await fs.writeFile(path.join(ROOT, "scripts", "career-pending-hook.cjs"), "process.exit(1);\n", "utf8");
    await git(["config", "core.hooksPath", ".githooks"]);

    const resilientHash = await commitFile(
      "src/agent.ts",
      "export const value = 2;\n",
      "Improve agent orchestration",
    );
    await expect(
      fs.readFile(
        path.join(ROOT, ".git", "career-capture", "pending", `${resilientHash}.json`),
        "utf8",
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });

    expect((await runCareerCli(["rebuild-pending"], { rootDir: ROOT })).created).toEqual([
      resilientHash,
    ]);
    const pendingBeforeCorruption = await snapshotPending();
    await fs.writeFile(
      path.join(ROOT, "career-prepare", "novel-agent", "index.json"),
      "{ invalid json",
      "utf8",
    );

    await expect(runCareerCli(["status"], { rootDir: ROOT })).rejects.toThrow();
    expect(await snapshotPending()).toEqual(pendingBeforeCorruption);
  });
});
