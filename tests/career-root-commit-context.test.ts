import { describe, expect, it } from "vitest";

import { loadCommitContext } from "../src/career/commit-context.js";
import type { GitRunner } from "../src/career/git-runner.js";

describe("root commit context", () => {
  it("asks Git to include root-commit file changes", async () => {
    const calls: string[][] = [];
    const runner: GitRunner = async (args) => {
      calls.push(args);
      if (args[0] === "show" && args[1] === "-s") {
        return "abc123\u0000\u0000main\u0000Initial agent\u0000\u00002026-07-10T00:00:00Z";
      }
      if (args[0] === "diff-tree") {
        return args.includes("--root") ? "A\tsrc/agent.ts" : "";
      }
      if (args[0] === "show" && args.includes("--stat")) return "1 file changed";
      if (args[0] === "show" && args.includes("--unified=80")) return "safe diff";
      throw new Error(`Unexpected Git args: ${args.join(" ")}`);
    };

    const context = await loadCommitContext("abc123", { rootDir: "/repo", runner });

    expect(context.parentHash).toBeNull();
    expect(context.files).toEqual([{ status: "A", path: "src/agent.ts" }]);
    expect(calls.find((args) => args[0] === "diff-tree")).toContain("--root");
  });
});
