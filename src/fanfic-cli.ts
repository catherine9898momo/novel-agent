import { initFanficProject, loadFanficProjectState } from "./fanfic/project.js";
import { runFanficCommand } from "./fanfic/commands.js";
import { readFanficIdeaInput } from "./fanfic/cli-input.js";
import { getNextAllowedAction } from "./fanfic/state-machine.js";
import type { FanficCommand } from "./fanfic/types.js";

const [cmd, storyId, maybeCommand, ...commandArgs] = process.argv.slice(2);

const USAGE = `
用法:
  npm run fanfic -- init <story_id>
  npm run fanfic -- status <story_id>
  npm run fanfic -- next <story_id>
  npm run fanfic -- run <story_id> <command>
  npm run fanfic -- run <story_id> parse_idea --idea-file <path>
  npm run fanfic -- run <story_id> parse_idea --idea "短同人创意"

story_id 第一版仅支持 ASCII kebab-case，例如 rain-letter。
`;

async function main(): Promise<void> {
  if (!cmd || !storyId) {
    console.log(USAGE);
    return;
  }

  switch (cmd) {
    case "init": {
      const project = await initFanficProject(storyId);
      console.log(`已初始化 fanfic 项目: fanfics/${storyId}`);
      console.log(`当前状态: ${project.state.status}`);
      break;
    }
    case "status": {
      const state = await loadFanficProjectState(storyId);
      printState(state);
      break;
    }
    case "next": {
      const state = await loadFanficProjectState(storyId);
      console.log(getNextAllowedAction(state) ?? "无可执行下一步");
      break;
    }
    case "run": {
      if (!maybeCommand) {
        console.log(USAGE);
        return;
      }
      const ideaText = maybeCommand === "parse_idea"
        ? await readFanficIdeaInput(commandArgs)
        : undefined;
      const next = await runFanficCommand(storyId, maybeCommand as FanficCommand, { ideaText });
      console.log(`已执行: ${maybeCommand}`);
      console.log(`当前状态: ${next.status}`);
      console.log(`下一步: ${getNextAllowedAction(next) ?? "无"}`);
      break;
    }
    default:
      console.log(USAGE);
  }
}

function printState(state: Awaited<ReturnType<typeof loadFanficProjectState>>): void {
  console.log(`story_id: ${state.storyId}`);
  console.log(`status: ${state.status}`);
  console.log(`revision: ${state.revision}`);
  console.log(`next: ${getNextAllowedAction(state) ?? "无"}`);
  const artifacts = Object.entries(state.artifacts);
  if (artifacts.length > 0) {
    console.log("artifacts:");
    for (const [key, artifact] of artifacts) {
      console.log(`  - ${key}: ${artifact.status} (${artifact.path})`);
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
