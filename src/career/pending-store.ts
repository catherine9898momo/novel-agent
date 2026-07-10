import fs from "fs/promises";
import path from "path";
import { readJsonFile, writeJsonAtomic } from "./json-file.js";
import type { PendingCommitRecord, PendingStatus } from "./types.js";

export class PendingStore {
  readonly pendingDir: string;

  constructor(gitDir: string) {
    this.pendingDir = path.join(gitDir, "career-capture", "pending");
  }

  async list(): Promise<PendingCommitRecord[]> {
    const names = await fs.readdir(this.pendingDir).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const records = await Promise.all(
      names.filter((name) => name.endsWith(".json")).map((name) => readJsonFile<PendingCommitRecord>(path.join(this.pendingDir, name))),
    );
    return records.sort((a, b) => b.committedAt.localeCompare(a.committedAt));
  }

  async read(commitHash: string): Promise<PendingCommitRecord | null> {
    return readJsonFile<PendingCommitRecord>(this.pathFor(commitHash)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
  }

  async write(record: PendingCommitRecord): Promise<void> {
    await writeJsonAtomic(this.pathFor(record.commitHash), record);
  }

  async mark(commitHash: string, status: PendingStatus, reason?: string, caseId?: string): Promise<PendingCommitRecord> {
    const current = await this.read(commitHash);
    if (!current) throw new Error(`Pending commit not found: ${commitHash}`);
    const next = { ...current, status, reason, caseId };
    await this.write(next);
    return next;
  }

  private pathFor(commitHash: string): string {
    if (!/^[a-f0-9]{6,64}$/i.test(commitHash)) throw new Error("Invalid commit hash");
    return path.join(this.pendingDir, `${commitHash}.json`);
  }
}
