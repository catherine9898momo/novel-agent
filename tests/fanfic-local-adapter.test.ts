import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import { initFanficUiSession, patchFanficUiStoryCard, runFanficUiAction } from "../src/fanfic/local-adapter.js";
import type { ParsedFanficIdea } from "../src/fanfic/idea-parser.js";
import type { FanficShortPlan } from "../src/fanfic/short-planner.js";
import type { FanficWriterContext } from "../src/fanfic/writer-context.js";
import type { FanficReview } from "../src/fanfic/reviewer.js";

const ROOT = path.resolve("fanfics/_test_local_adapter");
const STORY_ID = "ui-rain-letter";

const PARSED_IDEA: ParsedFanficIdea = {
  idea: {
    source: "示例恋歌",
    relationship: "沈知晚 x 陆承舟",
    timeline: "第二季结尾后",
    divergence: "陆承舟离开王都前一晚",
    tropes: ["旧信", "雨夜共伞"],
    dislikes: ["突然告白", "恋爱脑"],
    rating: "清水",
    targetWordCount: 100,
    ending: "开放式 HE",
    requiredScenes: ["旧信", "长廊雨声", "伞偏向她"],
    summary: "两个人在雨夜确认未说出口的心意。",
    rawIdea: "原始创意",
  },
  canon: {
    source: "示例恋歌",
    constraints: ["陆承舟习惯克制"],
    characterNotes: ["沈知晚敏锐但不会逼问"],
    timelineNotes: ["陆承舟离开前只剩一夜"],
    risks: ["不要破坏陆承舟自持"],
    rawIdea: "原始创意",
  },
};

const PLAN: FanficShortPlan = {
  title: "雨停前",
  logline: "旧信和长廊雨声让两人在离别前靠近。",
  premise: "沈知晚发现旧信，陆承舟以共伞回应。",
  emotionalArc: { from: "试探", to: "克制确认", turningPoint: "伞偏向她" },
  scenes: [
    { order: 1, title: "旧信", purpose: "引出心意", wordBudget: 25, beats: ["旧信出现", "长廊雨声"], requiredScenes: ["旧信", "长廊雨声"], canonConstraints: ["不逼问"], emotionalTurn: "试探" },
    { order: 2, title: "相遇", purpose: "拉近", wordBudget: 25, beats: ["陆承舟出现", "没有告白"], requiredScenes: [], canonConstraints: ["克制"], emotionalTurn: "靠近" },
    { order: 3, title: "共伞", purpose: "行动表达", wordBudget: 25, beats: ["伞偏向她", "肩头淋湿"], requiredScenes: ["伞偏向她"], canonConstraints: ["自持"], emotionalTurn: "确认" },
    { order: 4, title: "留信", purpose: "开放结尾", wordBudget: 25, beats: ["信放回", "天亮分别"], requiredScenes: [], canonConstraints: ["只剩一夜"], emotionalTurn: "余味" },
  ],
  requiredSceneCoverage: [
    { requiredScene: "旧信", sceneTitle: "旧信" },
    { requiredScene: "长廊雨声", sceneTitle: "旧信" },
    { requiredScene: "伞偏向她", sceneTitle: "共伞" },
  ],
  avoidChecks: ["避免突然告白", "避免恋爱脑"],
  endingStrategy: "开放式 HE",
  writerNotes: ["动作表达情绪"],
};

const DRAFT = [
  "# 雨停前",
  "",
  "旧信夹在书页里，长廊雨声压住了沈知晚的呼吸。",
  "陆承舟没有解释，只把伞偏向她那边，自己的肩头很快湿了一片。",
  "她没有追问，只把信重新放回书页。",
].join("\n");

const REVIEW: FanficReview = {
  score: 8,
  verdict: "needs_rewrite",
  dimensions: { canonFit: 4, requiredSceneCoverage: 5, avoidListSafety: 5, proseQuality: 3, relationshipTension: 4, pacing: 4 },
  passedChecks: ["旧信", "长廊雨声", "伞偏向她"],
  issues: [{ severity: "minor", area: "relationship_tension", message: "可增强余味", suggestion: "增加物件回环" }],
  rewriteBrief: ["增强结尾物件变化"],
};

const REWRITE = DRAFT + "\n\n信页合上时，伞沿又向她低了一寸。";

const options = {
  rootDir: ROOT,
  ideaParser: async (): Promise<ParsedFanficIdea> => PARSED_IDEA,
  planPlanner: async (): Promise<FanficShortPlan> => PLAN,
  draftWriter: async (_context: FanficWriterContext): Promise<string> => DRAFT,
  draftReviewer: async (): Promise<FanficReview> => REVIEW,
  draftRewriter: async (): Promise<string> => REWRITE,
};

beforeEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
});

afterEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
});

describe("fanfic local UI adapter", () => {
  it("initializes a UI session snapshot", async () => {
    const snapshot = await initFanficUiSession(STORY_ID, { rootDir: ROOT });

    expect(snapshot.storyId).toBe(STORY_ID);
    expect(snapshot.state.status).toBe("idea_pending_confirm");
    expect(snapshot.nextAction).toBe("parse_idea");
    expect(snapshot.artifacts).toEqual({});
  });



  it("patches one story card field without regenerating other artifacts", async () => {
    await initFanficUiSession(STORY_ID, { rootDir: ROOT });
    await runFanficUiAction(STORY_ID, "parse_idea", { ...options, ideaText: "原始创意" });

    const patchedIdea = await patchFanficUiStoryCard(STORY_ID, {
      target: "idea",
      field: "summary",
      value: "用户手动修正后的核心前提。",
    }, { rootDir: ROOT });

    expect(patchedIdea.state.status).toBe("idea_pending_confirm");
    expect(patchedIdea.artifacts.idea?.content.summary).toBe("用户手动修正后的核心前提。");
    expect(patchedIdea.artifacts.idea?.content.relationship).toBe("沈知晚 x 陆承舟");

    const patchedCanon = await patchFanficUiStoryCard(STORY_ID, {
      target: "canon",
      field: "constraints",
      value: ["用户确认的原作硬约束"],
    }, { rootDir: ROOT });

    expect(patchedCanon.artifacts.canon?.content.constraints).toEqual(["用户确认的原作硬约束"]);
  });

  it("rejects story card patch after the idea is confirmed", async () => {
    await initFanficUiSession(STORY_ID, { rootDir: ROOT });
    await runFanficUiAction(STORY_ID, "parse_idea", { ...options, ideaText: "原始创意" });
    await runFanficUiAction(STORY_ID, "approve_idea", options);

    await expect(patchFanficUiStoryCard(STORY_ID, {
      target: "idea",
      field: "summary",
      value: "太晚了",
    }, { rootDir: ROOT })).rejects.toThrow(/only editable before idea confirmation/i);
  });

  it("runs actions and returns renderable artifact contents", async () => {
    await initFanficUiSession(STORY_ID, { rootDir: ROOT });

    const parsed = await runFanficUiAction(STORY_ID, "parse_idea", { ...options, ideaText: "原始创意" });
    expect(parsed.state.status).toBe("idea_pending_confirm");
    expect(parsed.nextAction).toBe("approve_idea");
    expect(parsed.artifacts.idea?.content.source).toBe("示例恋歌");
    expect(parsed.artifacts.canon?.content.constraints).toContain("陆承舟习惯克制");

    await runFanficUiAction(STORY_ID, "approve_idea", options);
    const planned = await runFanficUiAction(STORY_ID, "generate_plan", options);
    expect(planned.state.status).toBe("plan_pending_confirm");
    expect(planned.artifacts.plan?.content.title).toBe("雨停前");

    await runFanficUiAction(STORY_ID, "approve_plan", options);
    const drafted = await runFanficUiAction(STORY_ID, "generate_draft", options);
    expect(drafted.state.status).toBe("draft_pending_confirm");
    expect(drafted.artifacts.draft?.content).toContain("伞偏向她");

    await runFanficUiAction(STORY_ID, "approve_draft", options);
    const reviewed = await runFanficUiAction(STORY_ID, "run_review", options);
    expect(reviewed.state.status).toBe("rewrite_pending_confirm");
    expect(reviewed.artifacts.review?.content.verdict).toBe("needs_rewrite");

    const rewritten = await runFanficUiAction(STORY_ID, "generate_rewrite", options);
    expect(rewritten.state.status).toBe("draft_pending_confirm");
    expect(rewritten.artifacts.rewriteDraft?.content).toContain("伞沿又向她低了一寸");

    await runFanficUiAction(STORY_ID, "approve_draft", options);
    await runFanficUiAction(STORY_ID, "run_review", options);
    const accepted = await runFanficUiAction(STORY_ID, "accept_final", options);
    expect(accepted.state.status).toBe("accepted");
    expect(accepted.nextAction).toBeNull();
    expect(accepted.artifacts.final?.content).toContain("伞沿又向她低了一寸");
  });
});
