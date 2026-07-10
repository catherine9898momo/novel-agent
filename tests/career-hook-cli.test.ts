import { afterEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import path from "path";
import { runCareerCli } from "../src/career/cli.js";

const ROOT = path.resolve(".tmp-career-hook-cli-test");
const GIT_DIR = path.join(ROOT, ".git");

afterEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
});

describe("career hook CLI", () => {
  it("installs the tracked hook path after verifying the hook exists", async () => {
    await fs.mkdir(path.join(ROOT, ".githooks"), { recursive: true });
    await fs.writeFile(path.join(ROOT, ".githooks", "post-commit"), "#!/bin/sh\n", "utf-8");
    const calls: string[][] = [];
    const runner = async (args: string[]) => {
      calls.push(args);
      return "";
    };
    expect(await runCareerCli(["install-hook"], { rootDir: ROOT, gitDir: GIT_DIR, runner }))
      .toEqual({ ok: true, command: "install-hook", hooksPath: ".githooks" });
    expect(calls).toContainEqual(["config", "core.hooksPath", ".githooks"]);
  });

  it("reports a healthy configured hook and pending count", async () => {
    await fs.mkdir(path.join(ROOT, ".githooks"), { recursive: true });
    await fs.writeFile(path.join(ROOT, ".githooks", "post-commit"), "#!/bin/sh\n", "utf-8");
    await fs.mkdir(path.join(GIT_DIR, "career-capture", "pending"), { recursive: true });
    await fs.writeFile(path.join(GIT_DIR, "career-capture", "pending", "abc123.json"), JSON.stringify({ commitHash: "abc123" }), "utf-8");
    const runner = async (args: string[]) => args.includes("--get") ? ".githooks" : "";
    expect(await runCareerCli(["doctor"], { rootDir: ROOT, gitDir: GIT_DIR, runner })).toEqual({
      ok: true,
      command: "doctor",
      configured: true,
      hookExists: true,
      pendingCount: 1,
    });
  });

  it("reports an unconfigured missing hook", async () => {
    const runner = async () => "";
    expect(await runCareerCli(["doctor"], { rootDir: ROOT, gitDir: GIT_DIR, runner })).toEqual({
      ok: true,
      command: "doctor",
      configured: false,
      hookExists: false,
      pendingCount: 0,
    });
  });
});
