import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(".tmp career hook safety test");

afterEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
});

async function initRepository(copyWriter = true): Promise<void> {
  await fs.mkdir(path.join(ROOT, ".githooks"), { recursive: true });
  await fs.mkdir(path.join(ROOT, "scripts"), { recursive: true });
  await fs.copyFile(path.resolve(".githooks/post-commit"), path.join(ROOT, ".githooks", "post-commit"));
  if (copyWriter) await fs.copyFile(path.resolve("scripts/career-pending-hook.cjs"), path.join(ROOT, "scripts", "career-pending-hook.cjs"));
  await fs.chmod(path.join(ROOT, ".githooks", "post-commit"), 0o755);
  await execFileAsync("git", ["init"], { cwd: ROOT });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: ROOT });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: ROOT });
  await execFileAsync("git", ["config", "core.hooksPath", ".githooks"], { cwd: ROOT });
}

async function commitFile(name: string, content: string, subject: string): Promise<string> {
  await fs.writeFile(path.join(ROOT, name), content, "utf-8");
  await execFileAsync("git", ["add", name], { cwd: ROOT });
  await execFileAsync("git", ["commit", "-m", subject], { cwd: ROOT });
  return (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: ROOT })).stdout.trim();
}

describe("career hook safety", () => {
  it("does not overwrite an existing processed record", async () => {
    await initRepository();
    const hash = await commitFile("a.txt", "a", "Add a");
    const pendingPath = path.join(ROOT, ".git", "career-capture", "pending", `${hash}.json`);
    const processed = { commitHash: hash, branch: "main", subject: "Add a", committedAt: "2026-07-10T00:00:00Z", detectedAt: "2026-07-10T00:00:01Z", status: "skipped", reason: "user_skipped" };
    await fs.writeFile(pendingPath, JSON.stringify(processed, null, 2), "utf-8");
    await execFileAsync("node", [path.join(ROOT, "scripts", "career-pending-hook.cjs"), ROOT], { cwd: ROOT });
    expect(JSON.parse(await fs.readFile(pendingPath, "utf-8"))).toEqual(processed);
  });

  it("does not fail a commit when the writer is missing", async () => {
    await initRepository(false);
    const result = await execFileAsync("git", ["commit", "--allow-empty", "-m", "Writer unavailable"], { cwd: ROOT });
    expect(result.stdout).toContain("Writer unavailable");
    expect((await execFileAsync("git", ["log", "-1", "--format=%s"], { cwd: ROOT })).stdout.trim()).toBe("Writer unavailable");
  });
});
