import { afterEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import path from "path";
import { CareerIndexStore } from "../src/career/career-index.js";

const ROOT = path.resolve(".tmp-career-index-test");

afterEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
});

describe("CareerIndexStore", () => {
  it("creates an empty index and records a skipped decision", async () => {
    const store = new CareerIndexStore(ROOT);
    expect(await store.load()).toEqual({ schemaVersion: 1, project: "novel-agent", cases: [], decisions: [] });

    await store.recordDecision({
      commitHash: "abc123",
      status: "skipped",
      decidedAt: "2026-07-10T11:00:00.000Z",
    });

    expect((await store.load()).decisions).toEqual([
      expect.objectContaining({ commitHash: "abc123", status: "skipped" }),
    ]);
  });

  it("rejects a malformed existing index", async () => {
    const dir = path.join(ROOT, "career-prepare", "novel-agent");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "index.json"), JSON.stringify({ schemaVersion: 99 }), "utf-8");
    await expect(new CareerIndexStore(ROOT).load()).rejects.toThrow(/Invalid career index/);
  });
});
