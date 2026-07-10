import type { CommitContext, CommitFileChange } from "./types.js";
import { runGit, type GitRunner } from "./git-runner.js";
import { isExcludedEvidencePath, redactSensitiveText } from "./redaction.js";

function parseFiles(raw: string): CommitFileChange[] {
  if (!raw) return [];
  return raw.split("\n").map((line) => {
    const [status, ...paths] = line.split("\t");
    return { status, path: paths.at(-1) ?? "" };
  });
}

export async function loadCommitContext(
  commitHash: string,
  options: { rootDir: string; runner?: GitRunner },
): Promise<CommitContext> {
  const runner = options.runner ?? runGit;
  const metadata = await runner(
    ["show", "-s", "--format=%H%x00%P%x00%D%x00%s%x00%b%x00%cI", commitHash],
    options.rootDir,
  );
  const fileOutput = await runner(
    ["diff-tree", "--no-commit-id", "--name-status", "-r", commitHash],
    options.rootDir,
  );
  const diffStat = await runner(
    ["show", "--stat", "--oneline", "--format=", commitHash],
    options.rootDir,
  );

  const [resolvedHash, parents, branch, subject, body, committedAt] = metadata.split("\u0000");
  const files = parseFiles(fileOutput);
  const excludedPaths = files
    .map((item) => item.path)
    .filter(isExcludedEvidencePath);
  const safePaths = files
    .map((item) => item.path)
    .filter((filePath) => !isExcludedEvidencePath(filePath));
  const diff = await runner(
    ["show", "--format=", "--unified=80", commitHash, "--", ...safePaths],
    options.rootDir,
  );

  return {
    commitHash: resolvedHash,
    parentHash: parents.split(" ")[0] || null,
    branch,
    subject,
    body,
    committedAt,
    files,
    diffStat,
    safeDiff: redactSensitiveText(diff),
    relatedTests: safePaths.filter((filePath) => /^tests\/.*\.test\.ts$/.test(filePath)),
    relatedDocs: safePaths.filter((filePath) => /^docs\/.*\.md$/.test(filePath)),
    excludedPaths,
  };
}
