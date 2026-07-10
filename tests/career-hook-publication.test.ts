import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "module";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";

const require = createRequire(import.meta.url);
const { publishPendingRecord } = require("../scripts/career-pending-hook.cjs") as {
  publishPendingRecord: (pendingDir: string, target: string, record: Record<string, unknown>, fileSystem?: typeof fs) => void;
};
const ROOT = path.resolve(".tmp-career-hook-publication-test");

afterEach(async () => {
  await fsPromises.rm(ROOT, { recursive: true, force: true });
});

describe("publishPendingRecord", () => {
  it("preserves a record that appears after temp write but before publication", async () => {
    const pendingDir = path.join(ROOT, "pending");
    const target = path.join(pendingDir, "abc123.json");
    const processed = { commitHash: "abc123", status: "skipped", reason: "user_skipped" };
    const racingFs = {
      ...fs,
      linkSync(source: fs.PathLike, destination: fs.PathLike) {
        expect(fs.existsSync(source)).toBe(true);
        fs.writeFileSync(destination, JSON.stringify(processed), "utf-8");
        const error = new Error("target created concurrently") as NodeJS.ErrnoException;
        error.code = "EEXIST";
        throw error;
      },
    } as typeof fs;

    publishPendingRecord(pendingDir, target, { commitHash: "abc123", status: "pending" }, racingFs);

    expect(JSON.parse(await fsPromises.readFile(target, "utf-8"))).toEqual(processed);
    expect((await fsPromises.readdir(pendingDir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});
