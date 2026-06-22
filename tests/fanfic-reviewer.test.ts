import { describe, it, expect, vi } from "vitest";
import { reviewFanficDraft } from "../src/fanfic/reviewer.js";
import { rewriteFanficDraft } from "../src/fanfic/rewriter.js";
import { buildFanficWriterContext } from "../src/fanfic/writer-context.js";
import type { FanficCanonCard, FanficIdeaCard } from "../src/fanfic/idea-parser.js";
import type { FanficShortPlan } from "../src/fanfic/short-planner.js";
import type { ModelEndpoint } from "../src/models.js";

const IDEA: FanficIdeaCard = {
  source: "示例恋歌", relationship: "沈知晚 x 陆承舟", timeline: "第二季结尾后", divergence: "离开前一晚",
  tropes: ["未寄出的信"], dislikes: ["突然告白", "恋爱脑"], rating: "清水", targetWordCount: 100, ending: "开放式 HE",
  requiredScenes: ["藏在书页里的旧信", "长廊雨声"], summary: "克制确认", rawIdea: "原始创意",
};
const CANON: FanficCanonCard = { source: "示例恋歌", constraints: ["陆承舟习惯克制"], characterNotes: ["沈知晚不逼问"], timelineNotes: ["只剩一夜"], risks: ["不要 OOC"], rawIdea: "原始创意" };
const PLAN: FanficShortPlan = {
  title: "雨停前的旧信", logline: "旧信让两人确认心意", premise: "雨夜旧信", emotionalArc: { from: "试探", to: "克制确认", turningPoint: "共伞" },
  scenes: [
    { order: 1, title: "旧信", purpose: "引出", wordBudget: 25, beats: ["发现旧信", "长廊雨声"], requiredScenes: ["藏在书页里的旧信", "长廊雨声"], canonConstraints: ["不逼问"], emotionalTurn: "心软", narrativeStrategy: strategy("半贴身", ["旧信", "长廊雨声"]) },
    { order: 2, title: "相遇", purpose: "靠近", wordBudget: 25, beats: ["陆承舟出现", "不点破"], requiredScenes: [], canonConstraints: ["克制"], emotionalTurn: "升温", narrativeStrategy: strategy("全知克制", ["灯影", "衣袖"]) },
    { order: 3, title: "共伞", purpose: "行动表达", wordBudget: 25, beats: ["伞偏向她", "肩头湿"], requiredScenes: [], canonConstraints: ["自持"], emotionalTurn: "明白", narrativeStrategy: strategy("旁观", ["伞沿", "肩头湿痕"]) },
    { order: 4, title: "留信", purpose: "余韵", wordBudget: 25, beats: ["信放回", "次日离别"], requiredScenes: [], canonConstraints: ["只剩一夜"], emotionalTurn: "希望", narrativeStrategy: strategy("半贴身", ["书页", "雨停后的檐声"]) }
  ],
  requiredSceneCoverage: [{ requiredScene: "藏在书页里的旧信", sceneTitle: "旧信" }, { requiredScene: "长廊雨声", sceneTitle: "旧信" }],
  avoidChecks: ["避免突然告白", "避免恋爱脑"], endingStrategy: "开放式", writerNotes: ["克制"],
};

function strategy(viewpointDistance: string, emotionCarriers: string[]) {
  return {
    purpose: "让情绪通过可见细节被读者看见，而不是由作者解释。",
    viewpointDistance,
    emotionCarriers,
    surfaceSignals: ["停顿", "避开视线", "手指压住纸页"],
    withheldInterior: ["不解释真正心意", "不写忽然明白"],
    antiClicheMoves: ["不用心如刀绞", "不用作者总结关系"],
    closingMove: "用一个未说尽的动作收束",
  };
}
const CONTEXT = buildFanficWriterContext(IDEA, CANON, PLAN);
const DRAFT = "# 雨停前的旧信\n\n藏在书页里的旧信被雨气润湿，长廊雨声很轻。陆承舟把伞偏向沈知晚，他们没有告白，只把话留在信里。";
const REVIEW = {
  score: 3, verdict: "needs_rewrite",
  dimensions: { canonFit: 4, requiredSceneCoverage: 5, avoidListSafety: 4, proseQuality: 3, relationshipTension: 3, pacing: 3 },
  passedChecks: ["覆盖旧信", "覆盖雨声"],
  issues: [{ severity: "major", area: "relationship_tension", message: "张力不足", suggestion: "增加共伞时的动作细节" }],
  rewriteBrief: ["增强共伞动作", "保留克制"],
};
function endpointWithText(text: string): ModelEndpoint {
  return { model: "test", provider: "openai-compatible", client: { messages: { create: vi.fn().mockResolvedValue({ content: [{ type: "text", text }] }) } } as unknown as ModelEndpoint["client"] };
}

function endpointWithTexts(texts: string[]): ModelEndpoint {
  return {
    model: "test",
    provider: "openai-compatible",
    client: {
      messages: {
        create: vi.fn()
          .mockResolvedValueOnce({ content: [{ type: "text", text: texts[0] }] })
          .mockResolvedValueOnce({ content: [{ type: "text", text: texts[1] }] }),
      },
    } as unknown as ModelEndpoint["client"],
  };
}

describe("fanfic reviewer and rewriter", () => {
  it("parses a structured review artifact", async () => {
    const review = await reviewFanficDraft(CONTEXT, DRAFT, { endpoint: endpointWithText(JSON.stringify(REVIEW)) });
    expect(review.verdict).toBe("needs_rewrite");
    expect(review.issues[0].suggestion).toContain("共伞");
    expect(review.rewriteBrief).toContain("保留克制");
  });
  it("asks the reviewer to audit narrative strategy execution", async () => {
    const endpoint = endpointWithText(JSON.stringify(REVIEW));
    await reviewFanficDraft(CONTEXT, DRAFT, { endpoint });

    const create = endpoint.client.messages.create as unknown as { mock: { calls: Array<[unknown]> } };
    const request = create.mock.calls[0]?.[0] as { system: string; messages?: Array<{ content: string }>; content?: string };
    const prompt = [request.system, request.content, request.messages?.[0]?.content].filter(Boolean).join("\n");
    expect(prompt).toContain("narrativeStrategy");
    expect(prompt).toContain("解释过度");
    expect(prompt).toContain("物件");
  });
  it("repairs non-JSON review output with one JSON-only retry", async () => {
    const endpoint = endpointWithTexts(["这篇整体需要改，主要问题是解释太多。", JSON.stringify(REVIEW)]);

    const review = await reviewFanficDraft(CONTEXT, DRAFT, { endpoint });

    expect(review.verdict).toBe("needs_rewrite");
    const create = endpoint.client.messages.create as unknown as { mock: { calls: Array<[unknown]> } };
    expect(create.mock.calls).toHaveLength(2);
    const repairRequest = create.mock.calls[1]?.[0] as { system: string; messages: Array<{ content: string }> };
    expect(repairRequest.system).toContain("JSON 修复器");
    expect(repairRequest.messages[0].content).toContain("原始非 JSON 输出");
  });

  it("rejects malformed review JSON after repair fails", async () => {
    await expect(reviewFanficDraft(CONTEXT, DRAFT, { endpoint: endpointWithText(JSON.stringify({ score: 3 })) }))
      .rejects.toThrow(/Invalid fanfic review/i);
  });
  it("rewrites the draft while preserving required scenes", async () => {
    const rewritten = await rewriteFanficDraft(CONTEXT, DRAFT, REVIEW, { endpoint: endpointWithText(DRAFT + "\n\n伞沿又低了一寸，雨声把沉默托得更近。") });
    expect(rewritten).toContain("藏在书页里的旧信");
    expect(rewritten).toContain("长廊雨声");
  });
  it("asks the rewriter to repair narrative strategy misses without changing story facts", async () => {
    const endpoint = endpointWithText(DRAFT + "\n\n伞沿又低了一寸，雨声把沉默托得更近。");
    await rewriteFanficDraft(CONTEXT, DRAFT, REVIEW, { endpoint });

    const create = endpoint.client.messages.create as unknown as { mock: { calls: Array<[unknown]> } };
    const request = create.mock.calls[0]?.[0] as { messages: Array<{ content: string }> };
    expect(request.messages[0].content).toContain("narrativeStrategy");
    expect(request.messages[0].content).toContain("删去解释");
    expect(request.messages[0].content).toContain("动作或物件");
  });
});
