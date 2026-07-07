import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import { initFanficProject } from "../src/fanfic/project.js";
import { runFanficCommand } from "../src/fanfic/commands.js";
import { continueFanficProject } from "../src/fanfic/orchestrator.js";
import type { ParsedFanficIdea } from "../src/fanfic/idea-parser.js";
import type { FanficShortPlan } from "../src/fanfic/short-planner.js";
import type { FanficWriterContext } from "../src/fanfic/writer-context.js";
import type { ObservabilityEvent } from "../src/observability/events.js";

const ROOT = path.resolve("fanfics/_test_orchestrator");
const STORY_ID = "rain-letter";

const PARSED_IDEA: ParsedFanficIdea = {
  idea: {
    source: "示例恋歌",
    relationship: "沈知晚 x 陆承舟",
    timeline: "第二季结尾后",
    divergence: "陆承舟离开王都前一晚",
    tropes: ["旧信"],
    dislikes: ["突然告白"],
    rating: "清水",
    targetWordCount: 1000,
    ending: "开放式 HE",
    requiredScenes: ["旧信"],
    summary: "雨夜里两人确认未说出口的心意。",
    rawIdea: "原始创意",
  },
  canon: {
    source: "示例恋歌",
    constraints: ["陆承舟习惯克制"],
    characterNotes: ["沈知晚不会逼问"],
    timelineNotes: ["离开前只剩一夜"],
    risks: ["不要突然告白"],
    rawIdea: "原始创意",
  },
};

const PLAN: FanficShortPlan = {
  title: "雨停前",
  logline: "旧信让两人在离别前靠近。",
  premise: "沈知晚发现旧信。",
  emotionalArc: { from: "试探", to: "确认", turningPoint: "共伞" },
  scenes: [
    { order: 1, title: "旧信", purpose: "引出心意", wordBudget: 250, beats: ["旧信出现"], requiredScenes: ["旧信"], canonConstraints: ["不逼问"], emotionalTurn: "试探" },
    { order: 2, title: "长廊", purpose: "靠近", wordBudget: 250, beats: ["长廊雨声"], requiredScenes: [], canonConstraints: ["克制"], emotionalTurn: "靠近" },
    { order: 3, title: "共伞", purpose: "行动表达", wordBudget: 250, beats: ["伞偏向她"], requiredScenes: [], canonConstraints: ["自持"], emotionalTurn: "确认" },
    { order: 4, title: "留信", purpose: "开放收束", wordBudget: 250, beats: ["信放回"], requiredScenes: [], canonConstraints: ["只剩一夜"], emotionalTurn: "余味" },
  ],
  requiredSceneCoverage: [{ requiredScene: "旧信", sceneTitle: "旧信" }],
  avoidChecks: ["避免突然告白"],
  endingStrategy: "开放式 HE",
  writerNotes: ["动作表达情绪"],
};

const options = {
  rootDir: ROOT,
  ideaText: "原始创意",
  ideaParser: async (): Promise<ParsedFanficIdea> => PARSED_IDEA,
  planPlanner: async (): Promise<FanficShortPlan> => PLAN,
  draftWriter: async (_context: FanficWriterContext): Promise<string> => "# 雨停前\n\n旧信夹在书页里。",
};

beforeEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
});

afterEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
});

describe("fanfic continue orchestrator", () => {
  it("runs the next automated action and stops at the idea approval gate", async () => {
    await initFanficProject(STORY_ID, { rootDir: ROOT });

    const result = await continueFanficProject(STORY_ID, options);

    expect(result.executedCommands).toEqual(["parse_idea"]);
    expect(result.state.status).toBe("idea_pending_confirm");
    expect(result.nextAction).toBe("approve_idea");
  });

  it("continues from confirmed plan through draft generation and stops at draft approval", async () => {
    await initFanficProject(STORY_ID, { rootDir: ROOT });
    await runFanficCommand(STORY_ID, "parse_idea", options);
    await runFanficCommand(STORY_ID, "approve_idea", { rootDir: ROOT });
    await runFanficCommand(STORY_ID, "generate_plan", options);
    await runFanficCommand(STORY_ID, "approve_plan", { rootDir: ROOT });

    const result = await continueFanficProject(STORY_ID, options);

    expect(result.executedCommands).toEqual(["generate_draft"]);
    expect(result.state.status).toBe("draft_pending_confirm");
    expect(result.nextAction).toBe("approve_draft");
    await expect(fs.stat(path.join(ROOT, STORY_ID, "_drafts", "draft-001.md"))).resolves.toBeTruthy();
  });


  it("emits workflow and command events when an automated command succeeds", async () => {
    await initFanficProject(STORY_ID, { rootDir: ROOT });
    const events: ObservabilityEvent[] = [];

    const result = await continueFanficProject(STORY_ID, { ...options, eventSink: (event) => events.push(event) });

    expect(result.executedCommands).toEqual(["parse_idea"]);
    expect(events.map((event) => event.type)).toEqual([
      "workflow_started",
      "command_started",
      "command_succeeded",
      "workflow_stopped",
    ]);
    expect(events[1]).toMatchObject({ command: "parse_idea", fromStatus: "idea_pending_confirm" });
    expect(events[2]).toMatchObject({ command: "parse_idea", fromStatus: "idea_pending_confirm", toStatus: "idea_pending_confirm" });
    expect(events[2].durationMs).toEqual(expect.any(Number));
    expect(events[3]).toMatchObject({ stopReason: "max_steps", nextAction: "approve_idea" });
  });

  it("emits a human gate stop event without running a command", async () => {
    await initFanficProject(STORY_ID, { rootDir: ROOT });
    await runFanficCommand(STORY_ID, "parse_idea", options);
    const events: ObservabilityEvent[] = [];

    const result = await continueFanficProject(STORY_ID, { rootDir: ROOT, eventSink: (event) => events.push(event) });

    expect(result.executedCommands).toEqual([]);
    expect(result.stoppedReason).toBe("awaiting_human");
    expect(events.map((event) => event.type)).toEqual(["workflow_started", "workflow_stopped"]);
    expect(events[1]).toMatchObject({ stopReason: "awaiting_human", nextAction: "approve_idea" });
  });

  it("emits command failure events before surfacing the error", async () => {
    await initFanficProject(STORY_ID, { rootDir: ROOT });
    const events: ObservabilityEvent[] = [];

    await expect(continueFanficProject(STORY_ID, {
      ...options,
      ideaParser: async () => { throw new Error("parser unavailable"); },
      eventSink: (event) => events.push(event),
    })).rejects.toThrow(/parser unavailable/);

    expect(events.map((event) => event.type)).toEqual([
      "workflow_started",
      "command_started",
      "command_failed",
      "workflow_stopped",
    ]);
    expect(events[2]).toMatchObject({ command: "parse_idea", errorClass: "Error", errorMessage: "parser unavailable" });
    expect(events[3]).toMatchObject({ stopReason: "command_failed", nextAction: "parse_idea" });
  });
});
