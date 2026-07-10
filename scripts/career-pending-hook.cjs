const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function gitOptional(root, args, fallback) {
  try {
    return git(root, args);
  } catch {
    return fallback;
  }
}

function main() {
  const root = process.argv[2];
  if (!root) return;
  const rawGitDir = git(root, ["rev-parse", "--git-dir"]);
  const gitDir = path.isAbsolute(rawGitDir) ? rawGitDir : path.resolve(root, rawGitDir);
  const commitHash = git(root, ["rev-parse", "HEAD"]);
  const branch = gitOptional(root, ["symbolic-ref", "--short", "-q", "HEAD"], "detached");
  const subject = git(root, ["log", "-1", "--format=%s"]);
  const committedAt = git(root, ["log", "-1", "--format=%cI"]);
  const pendingDir = path.join(gitDir, "career-capture", "pending");
  const target = path.join(pendingDir, `${commitHash}.json`);
  if (fs.existsSync(target)) return;
  fs.mkdirSync(pendingDir, { recursive: true });
  const temp = path.join(pendingDir, `.${commitHash}.${process.pid}.tmp`);
  fs.writeFileSync(temp, `${JSON.stringify({
    commitHash,
    branch,
    subject,
    committedAt,
    detectedAt: new Date().toISOString(),
    status: "pending",
  }, null, 2)}\n`, "utf8");
  fs.renameSync(temp, target);
}

try {
  main();
} catch (error) {
  process.stderr.write(`[career-capture] ${error instanceof Error ? error.message : String(error)}\n`);
}
