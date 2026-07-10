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

async function prepareRepository(): Promise<void> {
  await fs.mkdir(path.join(ROOT, ".githooks"), { recursive: true });
  await fs.mkdir(path.join(ROOT, "scripts"), { recursive: true });
  await fs.copyFile(path.resolve(".githooks/post-commit"), path.join(ROOT, ".githooks", "post-commit"));
  await fs.copyFile(path.resolve("scripts/career-pending-hook.cjs"), path.join(ROOT, "scripts", "career-pending-hook.cjs"));
  await fs.chmod(path.join(ROOT, ".githooks", "post-commit"), 0o755);
  await execFileAsync("git", ["init"], { cwd: ROOT });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: ROOT });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: ROOT });
  await execFileAsync("git", ["config", "core.hooksPath", ".githooks"], { cwd: ROOT });
}

describe("career post-commit hook", () => {
  it("records a pending commit without changing commit success", async () => {
    await prepareRepository();
    await fs.writeFile(path.join(ROOT, "a.txt"), "a", "utf-8");
    await execFileAsync("git", ["add", "a.txt"], { cwd: ROOT });
    await execFileAsync("git", ["commit", "-m", "Add a"], { cwd: ROOT });
    const hash = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: ROOT })).stdout.trim();
    const record = JSON.parse(await fs.readFile(path.join(ROOT, ".git", "career-capture", "pending", `${hash}.json`), "utf-8"));
    expect(record).toMatchObject({ commitHash: hash, subject: "Add a", status: "pending" });
  });

  it("records detached HEAD commits with a detached branch label", async () => {
    await prepareRepository();
    await fs.writeFile(path.join(ROOT, "a.txt"), "a", "utf-8");
    await execFileAsync("git", ["add", "a.txt"], { cwd: ROOT });
    await execFileAsync("git", ["commit", "-m", "Initial"], { cwd: ROOT });
    await execFileAsync("git", ["checkout", "--detach"], { cwd: ROOT });
    await fs.writeFile(path.join(ROOT, "b.txt"), "b", "utf-8");
    await execFileAsync("git", ["add", "b.txt"], { cwd: ROOT });
    await execFileAsync("git", ["commit", "-m", "Detached"], { cwd: ROOT });
    const hash = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: ROOT })).stdout.trim();
    const record = JSON.parse(await fs.readFile(path.join(ROOT, ".git", "career-capture", "pending", `${hash}.json`), "utf-8"));
    expect(record).toMatchObject({ branch: "detached", subject: "Detached" });
  });
});
