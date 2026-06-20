import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import { initFanficProject, loadFanficProjectState } from "../src/fanfic/project.js";
import { runFanficCommand } from "../src/fanfic/commands.js";
import type { ParsedFanficIdea } from "../src/fanfic/idea-parser.js";
import type { FanficShortPlan } from "../src/fanfic/short-planner.js";
import type { FanficWriterContext } from "../src/fanfic/writer-context.js";
import type { FanficReview } from "../src/fanfic/reviewer.js";

const ROOT = path.resolve("fanfics/_test_phase1");

const PARSED_IDEA: ParsedFanficIdea = {
  idea: {
    source: "示例恋歌",
    relationship: "沈知晚 x 陆承舟",
    timeline: "第二季结尾后",
    divergence: "陆承舟离开王都前一晚",
    tropes: ["未寄出的信", "雨夜共伞"],
    dislikes: ["突然告白", "恋爱脑"],
    rating: "清水",
    targetWordCount: 5000,
    ending: "开放式 HE",
    requiredScenes: ["藏在书页里的旧信", "长廊雨声"],
    summary: "两个人在离别前确认彼此没有说出口的心意。",
    rawIdea: "原始创意",
  },
  canon: {
    source: "示例恋歌",
    constraints: ["陆承舟习惯克制"],
    characterNotes: ["沈知晚敏锐但不会逼问"],
    timelineNotes: ["陆承舟离开前只剩一夜"],
    risks: ["不要破坏陆承舟一贯自持"],
    rawIdea: "原始创意",
  },
};

const parseOptions = {
  ideaText: "原始创意",
  ideaParser: async (): Promise<ParsedFanficIdea> => PARSED_IDEA,
};

const SHORT_PLAN: FanficShortPlan = {
  title: "雨停前的旧信",
  logline: "一封未寄出的信让两人在离别前确认克制的心意。",
  premise: "雨夜里，沈知晚发现陆承舟从未寄出的信。",
  emotionalArc: { from: "试探", to: "克制确认", turningPoint: "长廊共伞时她看见他肩头淋湿" },
  scenes: [
    { order: 1, title: "旧信被发现", purpose: "引出未说出口的心意", wordBudget: 1100, beats: ["沈知晚在书页里发现旧信", "长廊雨声压住翻页声"], requiredScenes: ["藏在书页里的旧信", "长廊雨声"], canonConstraints: ["沈知晚不会逼问"], emotionalTurn: "疑心转为心软" },
    { order: 2, title: "廊下相遇", purpose: "让两人回避又靠近", wordBudget: 1200, beats: ["陆承舟出现", "两人都不点破旧信"], requiredScenes: [], canonConstraints: ["陆承舟习惯克制"], emotionalTurn: "克制升温" },
    { order: 3, title: "雨夜共伞", purpose: "用行动替代告白", wordBudget: 1300, beats: ["他把伞偏向她", "她看见他肩头淋湿"], requiredScenes: [], canonConstraints: ["不要破坏陆承舟一贯自持"], emotionalTurn: "明白但不说破" },
    { order: 4, title: "信留书页", purpose: "开放式 HE 收束", wordBudget: 1400, beats: ["她把信放回书页", "次日离别留下余味"], requiredScenes: [], canonConstraints: ["离开前只剩一夜"], emotionalTurn: "离别中保留希望" }
  ],
  requiredSceneCoverage: [
    { requiredScene: "藏在书页里的旧信", sceneTitle: "旧信被发现" },
    { requiredScene: "长廊雨声", sceneTitle: "旧信被发现" }
  ],
  avoidChecks: ["避免突然告白", "避免恋爱脑", "不破坏陆承舟一贯自持"],
  endingStrategy: "开放式 HE：两人明白彼此，但把确认留给离别后的回信。",
  writerNotes: ["用动作和物件承载情绪", "不要让角色直接剖白"],
};

const planOptions = {
  planPlanner: async (): Promise<FanficShortPlan> => SHORT_PLAN,
};

const DRAFT_TEXT = [
  "# 雨停前的旧信",
  "",
  "藏在书页里的旧信被雨气润得微微发皱。沈知晚没有追问，只听长廊雨声一层层落下来。陆承舟站在灯影外，仍旧克制地垂着眼。",
  "他把伞偏向她，自己的肩头很快湿了一片。她看见了，却也没有点破，只把那封旧信重新夹回书页。",
  "天亮前，他们谁都没有把话说尽。雨停时，信还在原处，像一场尚未寄出的回答。"
].join("\n");

const draftOptions = {
  draftWriter: async (_context: FanficWriterContext): Promise<string> => DRAFT_TEXT,
};

const REVIEW_ARTIFACT: FanficReview = {
  score: 3,
  verdict: "needs_rewrite",
  dimensions: { canonFit: 4, requiredSceneCoverage: 5, avoidListSafety: 4, proseQuality: 3, relationshipTension: 3, pacing: 3 },
  passedChecks: ["覆盖旧信", "覆盖雨声"],
  issues: [{ severity: "major", area: "relationship_tension", message: "张力不足", suggestion: "增加共伞时的动作细节" }],
  rewriteBrief: ["增强共伞动作", "保留克制"],
};

const reviewOptions = {
  draftReviewer: async (): Promise<FanficReview> => REVIEW_ARTIFACT,
};

const REWRITE_TEXT = DRAFT_TEXT + "\n\n伞沿又低了一寸，长廊雨声把沉默托得更近。";

const rewriteOptions = {
  draftRewriter: async (): Promise<string> => REWRITE_TEXT,
};

beforeEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
});

afterEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
});

describe("fanfic project initialization", () => {
  it("creates a project directory, subdirectories, and initial state", async () => {
    const result = await initFanficProject("rain-letter", { rootDir: ROOT });

    expect(result.state.status).toBe("idea_pending_confirm");
    await expect(fs.stat(path.join(ROOT, "rain-letter", "_state.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(ROOT, "rain-letter", "_context"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(ROOT, "rain-letter", "_drafts"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(ROOT, "rain-letter", "_reviews"))).resolves.toBeTruthy();
  });

  it("rejects non kebab-case story ids", async () => {
    await expect(initFanficProject("雨夜旧信", { rootDir: ROOT }))
      .rejects.toThrow(/story_id/i);
  });
});

describe("fanfic command artifacts", () => {
  it("writes mock artifacts while advancing through the workflow", async () => {
    await initFanficProject("rain-letter", { rootDir: ROOT });

    await runFanficCommand("rain-letter", "parse_idea", { rootDir: ROOT, ...parseOptions });
    await expect(fs.stat(path.join(ROOT, "rain-letter", "_idea.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(ROOT, "rain-letter", "_canon.json"))).resolves.toBeTruthy();

    await runFanficCommand("rain-letter", "approve_idea", { rootDir: ROOT });
    await runFanficCommand("rain-letter", "generate_plan", { rootDir: ROOT, ...planOptions });
    await expect(fs.stat(path.join(ROOT, "rain-letter", "_plan.json"))).resolves.toBeTruthy();

    await runFanficCommand("rain-letter", "approve_plan", { rootDir: ROOT });
    await runFanficCommand("rain-letter", "generate_draft", { rootDir: ROOT, ...draftOptions });
    await expect(fs.stat(path.join(ROOT, "rain-letter", "_context", "writer-context-001.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(ROOT, "rain-letter", "_drafts", "draft-001.md"))).resolves.toBeTruthy();

    await runFanficCommand("rain-letter", "approve_draft", { rootDir: ROOT });
    await runFanficCommand("rain-letter", "run_review", { rootDir: ROOT, ...reviewOptions });
    await expect(fs.stat(path.join(ROOT, "rain-letter", "_reviews", "review-001.json"))).resolves.toBeTruthy();

    await runFanficCommand("rain-letter", "generate_rewrite", { rootDir: ROOT, ...rewriteOptions });
    await expect(fs.stat(path.join(ROOT, "rain-letter", "_drafts", "draft-002.md"))).resolves.toBeTruthy();

    await runFanficCommand("rain-letter", "approve_draft", { rootDir: ROOT });
    await runFanficCommand("rain-letter", "run_review", { rootDir: ROOT, ...reviewOptions });
    await runFanficCommand("rain-letter", "accept_final", { rootDir: ROOT });
    await expect(fs.stat(path.join(ROOT, "rain-letter", "final.md"))).resolves.toBeTruthy();

    const state = await loadFanficProjectState("rain-letter", { rootDir: ROOT });
    expect(state.status).toBe("accepted");
  });

  it("writes parsed idea and canon artifacts from the idea parser", async () => {
    await initFanficProject("rain-letter", { rootDir: ROOT });

    const state = await runFanficCommand("rain-letter", "parse_idea", { rootDir: ROOT, ...parseOptions });
    const idea = JSON.parse(await fs.readFile(path.join(ROOT, "rain-letter", "_idea.json"), "utf-8"));
    const canon = JSON.parse(await fs.readFile(path.join(ROOT, "rain-letter", "_canon.json"), "utf-8"));

    expect(state.status).toBe("idea_pending_confirm");
    expect(state.artifacts.idea?.status).toBe("drafted");
    expect(idea.source).toBe("示例恋歌");
    expect(idea.requiredScenes).toContain("藏在书页里的旧信");
    expect(canon.constraints).toContain("陆承舟习惯克制");
  });

  it("writes a short plan artifact from the planner", async () => {
    await initFanficProject("rain-letter", { rootDir: ROOT });
    await runFanficCommand("rain-letter", "parse_idea", { rootDir: ROOT, ...parseOptions });
    await runFanficCommand("rain-letter", "approve_idea", { rootDir: ROOT });

    const state = await runFanficCommand("rain-letter", "generate_plan", { rootDir: ROOT, ...planOptions });
    const plan = JSON.parse(await fs.readFile(path.join(ROOT, "rain-letter", "_plan.json"), "utf-8"));

    expect(state.status).toBe("plan_pending_confirm");
    expect(state.artifacts.plan?.status).toBe("drafted");
    expect(plan.title).toBe("雨停前的旧信");
    expect(plan.scenes[0].beats).toContain("沈知晚在书页里发现旧信");
    expect(plan.requiredSceneCoverage.map((item: { requiredScene: string }) => item.requiredScene)).toEqual(PARSED_IDEA.idea.requiredScenes);
  });

  it("writes writer context and draft artifacts from confirmed plan", async () => {
    await initFanficProject("rain-letter", { rootDir: ROOT });
    await runFanficCommand("rain-letter", "parse_idea", { rootDir: ROOT, ...parseOptions });
    await runFanficCommand("rain-letter", "approve_idea", { rootDir: ROOT });
    await runFanficCommand("rain-letter", "generate_plan", { rootDir: ROOT, ...planOptions });
    await runFanficCommand("rain-letter", "approve_plan", { rootDir: ROOT });

    const state = await runFanficCommand("rain-letter", "generate_draft", { rootDir: ROOT, ...draftOptions });
    const context = JSON.parse(await fs.readFile(path.join(ROOT, "rain-letter", "_context", "writer-context-001.json"), "utf-8"));
    const draft = await fs.readFile(path.join(ROOT, "rain-letter", "_drafts", "draft-001.md"), "utf-8");

    expect(state.status).toBe("draft_pending_confirm");
    expect(state.artifacts.context?.status).toBe("created");
    expect(state.artifacts.draft?.status).toBe("drafted");
    expect(context.requiredScenes).toEqual(PARSED_IDEA.idea.requiredScenes);
    expect(context.plan.scenes[0].beats).toContain("沈知晚在书页里发现旧信");
    expect(draft).toContain("藏在书页里的旧信");
    expect(draft).toContain("长廊雨声");
  });

  it("writes review rewrite and final artifacts", async () => {
    await initFanficProject("rain-letter", { rootDir: ROOT });
    await runFanficCommand("rain-letter", "parse_idea", { rootDir: ROOT, ...parseOptions });
    await runFanficCommand("rain-letter", "approve_idea", { rootDir: ROOT });
    await runFanficCommand("rain-letter", "generate_plan", { rootDir: ROOT, ...planOptions });
    await runFanficCommand("rain-letter", "approve_plan", { rootDir: ROOT });
    await runFanficCommand("rain-letter", "generate_draft", { rootDir: ROOT, ...draftOptions });
    await runFanficCommand("rain-letter", "approve_draft", { rootDir: ROOT });

    const reviewed = await runFanficCommand("rain-letter", "run_review", { rootDir: ROOT, ...reviewOptions });
    const review = JSON.parse(await fs.readFile(path.join(ROOT, "rain-letter", "_reviews", "review-001.json"), "utf-8"));
    expect(reviewed.status).toBe("rewrite_pending_confirm");
    expect(review.verdict).toBe("needs_rewrite");

    const rewritten = await runFanficCommand("rain-letter", "generate_rewrite", { rootDir: ROOT, ...rewriteOptions });
    const rewriteDraft = await fs.readFile(path.join(ROOT, "rain-letter", "_drafts", "draft-002.md"), "utf-8");
    expect(rewritten.status).toBe("draft_pending_confirm");
    expect(rewriteDraft).toContain("伞沿又低了一寸");

    await runFanficCommand("rain-letter", "approve_draft", { rootDir: ROOT });
    await runFanficCommand("rain-letter", "run_review", { rootDir: ROOT, ...reviewOptions });
    const accepted = await runFanficCommand("rain-letter", "accept_final", { rootDir: ROOT });
    const finalText = await fs.readFile(path.join(ROOT, "rain-letter", "final.md"), "utf-8");
    expect(accepted.status).toBe("accepted");
    expect(finalText).toContain("伞沿又低了一寸");
  });

  it("requires idea text before parsing fanfic idea", async () => {
    await initFanficProject("rain-letter", { rootDir: ROOT });

    await expect(runFanficCommand("rain-letter", "parse_idea", { rootDir: ROOT }))
      .rejects.toThrow(/parse_idea requires ideaText/i);
  });

  it("does not run old commands after their gate is closed", async () => {
    await initFanficProject("rain-letter", { rootDir: ROOT });
    await runFanficCommand("rain-letter", "parse_idea", { rootDir: ROOT, ...parseOptions });
    await runFanficCommand("rain-letter", "approve_idea", { rootDir: ROOT });

    await expect(runFanficCommand("rain-letter", "parse_idea", { rootDir: ROOT, ...parseOptions }))
      .rejects.toThrow(/not allowed/i);
  });
});
