import fs from "fs/promises";
import path from "path";
import { readJsonFile, writeJsonAtomic } from "./json-file.js";
import {
  EMPTY_CAREER_INDEX,
  type CareerCaseIndexEntry,
  type CareerDecision,
  type CareerIndex,
} from "./types.js";

function isCareerIndex(value: unknown): value is CareerIndex {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CareerIndex>;
  return candidate.schemaVersion === 1
    && candidate.project === "novel-agent"
    && Array.isArray(candidate.cases)
    && Array.isArray(candidate.decisions);
}

export class CareerIndexStore {
  private readonly indexPath: string;

  constructor(rootDir: string) {
    this.indexPath = path.join(rootDir, "career-prepare", "novel-agent", "index.json");
  }

  async load(): Promise<CareerIndex> {
    const index = await readJsonFile<unknown>(this.indexPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return structuredClone(EMPTY_CAREER_INDEX);
      throw error;
    });
    if (!isCareerIndex(index)) throw new Error("Invalid career index");
    return index;
  }

  async save(index: CareerIndex): Promise<void> {
    await writeJsonAtomic(this.indexPath, index);
  }

  async hasDecision(commitHash: string): Promise<boolean> {
    return (await this.load()).decisions.some((decision) => decision.commitHash === commitHash);
  }

  async recordDecision(decision: CareerDecision): Promise<void> {
    const index = await this.load();
    index.decisions = index.decisions.filter((current) => current.commitHash !== decision.commitHash);
    index.decisions.push(decision);
    await this.save(index);
  }

  async registerCase(entry: CareerCaseIndexEntry): Promise<void> {
    const index = await this.load();
    index.cases = index.cases.filter((current) => current.caseId !== entry.caseId);
    index.cases.push(entry);

    const decidedAt = new Date().toISOString();
    for (const commitHash of entry.commitHashes) {
      index.decisions = index.decisions.filter((decision) => decision.commitHash !== commitHash);
      index.decisions.push({
        commitHash,
        status: "captured",
        caseId: entry.caseId,
        decidedAt,
      });
    }

    await this.save(index);
  }
}
