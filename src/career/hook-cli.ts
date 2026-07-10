import fs from "fs/promises";
import path from "path";
import type { CareerCliResult } from "./types.js";
import type { GitRunner } from "./git-runner.js";
import type { PendingStore } from "./pending-store.js";

export async function runInstallHook(runner: GitRunner, rootDir: string): Promise<CareerCliResult> {
  const hookPath = path.join(rootDir, ".githooks", "post-commit");
  const hookExists = await fileExists(hookPath);
  if (!hookExists) throw new Error("Career post-commit hook not found");
  await runner(["config", "core.hooksPath", ".githooks"], rootDir);
  return { ok: true, command: "install-hook", hooksPath: ".githooks" };
}

export async function runDoctor(runner: GitRunner, rootDir: string, pendingStore: PendingStore): Promise<CareerCliResult> {
  const hooksPath = await runner(["config", "--get", "core.hooksPath"], rootDir).catch(() => "");
  return {
    ok: true,
    command: "doctor",
    configured: hooksPath.trim() === ".githooks",
    hookExists: await fileExists(path.join(rootDir, ".githooks", "post-commit")),
    pendingCount: (await pendingStore.list()).length,
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  return fs.stat(filePath).then((stat) => stat.isFile()).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
}
