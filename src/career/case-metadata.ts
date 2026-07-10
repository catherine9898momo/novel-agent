import fs from "fs/promises";
import path from "path";

export interface CareerCaseMetadata {
  caseId: string;
  title: string;
  commitHashes: string[];
  topics: string[];
  evidenceStatus: "complete" | "needs_metrics" | "needs_review";
  createdAt: string;
  updatedAt: string;
}

const EVIDENCE_STATUSES = new Set<CareerCaseMetadata["evidenceStatus"]>([
  "complete",
  "needs_metrics",
  "needs_review",
]);

export async function loadCaseMetadata(rootDir: string, caseId: string): Promise<CareerCaseMetadata> {
  assertCaseId(caseId);
  const filePath = path.join(rootDir, "career-prepare", "novel-agent", "cases", `${caseId}.md`);
  const raw = await fs.readFile(filePath, "utf-8");
  const fields = parseFrontmatter(raw);
  const parsed: CareerCaseMetadata = {
    caseId: requiredScalar(fields, "caseId"),
    title: requiredScalar(fields, "title"),
    commitHashes: requiredStringArray(fields, "commitHashes"),
    topics: requiredStringArray(fields, "topics"),
    evidenceStatus: requiredEvidenceStatus(fields),
    createdAt: requiredScalar(fields, "createdAt"),
    updatedAt: requiredScalar(fields, "updatedAt"),
  };
  if (parsed.caseId !== caseId) throw new Error("Invalid career case metadata: caseId mismatch");
  if (parsed.commitHashes.length === 0) throw new Error("Invalid career case metadata: commitHashes must not be empty");
  return parsed;
}

function parseFrontmatter(raw: string): Map<string, string> {
  const normalized = raw.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) throw new Error("Invalid career case metadata: missing frontmatter");
  const end = normalized.indexOf("\n---", 4);
  if (end === -1) throw new Error("Invalid career case metadata: unterminated frontmatter");
  const fields = new Map<string, string>();
  for (const line of normalized.slice(4, end).split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) throw new Error("Invalid career case metadata: malformed field");
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!key || !value || fields.has(key)) throw new Error("Invalid career case metadata: invalid field");
    fields.set(key, value);
  }
  return fields;
}

function requiredScalar(fields: Map<string, string>, key: string): string {
  const value = fields.get(key)?.trim();
  if (!value) throw new Error(`Invalid career case metadata: missing ${key}`);
  return value;
}

function requiredStringArray(fields: Map<string, string>, key: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(requiredScalar(fields, key));
  } catch {
    throw new Error(`Invalid career case metadata: ${key} must be a JSON string array`);
  }
  if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "string" && value.trim())) {
    throw new Error(`Invalid career case metadata: ${key} must be a JSON string array`);
  }
  return parsed;
}

function requiredEvidenceStatus(fields: Map<string, string>): CareerCaseMetadata["evidenceStatus"] {
  const value = requiredScalar(fields, "evidenceStatus") as CareerCaseMetadata["evidenceStatus"];
  if (!EVIDENCE_STATUSES.has(value)) throw new Error("Invalid career case metadata: invalid evidenceStatus");
  return value;
}

function assertCaseId(caseId: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(caseId)) throw new Error("Invalid career case id");
}
