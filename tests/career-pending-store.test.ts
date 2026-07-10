import { afterEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import path from "path";
import { PendingStore } from "../src/career/pending-store.js";

const ROOT = path.resolve(".tmp-career-pending-test");
const GIT_DIR = path.join(ROOT, ".git");

afterEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
});

describe("PendingStore", () => {
  it("writes, lists, and marks a pending commit", async () => {
    const store = new PendingStore(GIT_DIR);
    await store.write({
      commitHash: "abc123",
      branch: "main",
      subject: "Add revision engine",
      committedAt: "2026-07-10T10:00:00.000Z",
      detectedAt: "2026-07-10T10:00:01.000Z",
      status: "pending",
    });

    expect(await store.list()).toEqual([
      expect.objectContaining({ commitHash: "abc123", status: "pending" }),
    ]);

    await store.mark("abc123", "skipped", "user_declined");
    expect(await store.read("abc123")).toMatchObject({
      status: "skipped",
      reason: "user_declined",
    });
  });

  it("returns an empty list when no pending directory exists", async () => {
    expect(await new PendingStore(GIT_DIR).list()).toEqual([]);
  });
});
