import { execFile } from "child_process";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export type GitRunner = (args: string[], cwd: string) => Promise<string>;

export const runGit: GitRunner = async (args, cwd) => {
  const result = await execFileAsync("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 });
  return result.stdout.trimEnd();
};

export async function resolveGitDir(rootDir: string, runner: GitRunner = runGit): Promise<string> {
  const raw = await runner(["rev-parse", "--git-dir"], rootDir);
  return path.isAbsolute(raw) ? raw : path.resolve(rootDir, raw);
}
