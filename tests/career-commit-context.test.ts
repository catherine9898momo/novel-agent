import { describe, expect, it } from "vitest";
import path from "path";
import { loadCommitContext } from "../src/career/commit-context.js";
import { resolveGitDir, type GitRunner } from "../src/career/git-runner.js";

describe("resolveGitDir", () => {
  it("resolves a relative Git directory under the repository root", async () => {
    const runner: GitRunner = async () => ".git";

    await expect(resolveGitDir("/repo", runner)).resolves.toBe(path.resolve("/repo", ".git"));
  });

  it("keeps an absolute Git directory unchanged", async () => {
    const runner: GitRunner = async () => "/worktrees/repo";

    await expect(resolveGitDir("/repo", runner)).resolves.toBe("/worktrees/repo");
  });
});

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
