import { runCareerCli } from "./career/cli.js";

runCareerCli(process.argv.slice(2), { rootDir: process.cwd() })
  .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
  .catch((error) => {
    process.stdout.write(`${JSON.stringify({ ok: false, error: { code: "career_command_failed", message: error instanceof Error ? error.message : String(error) } })}\n`);
    process.exitCode = 1;
  });
