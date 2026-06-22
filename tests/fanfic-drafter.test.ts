import { describe, it, expect, vi } from "vitest";
import { buildFanficWriterContext } from "../src/fanfic/writer-context.js";
import { draftFanficShortStory } from "../src/fanfic/drafter.js";
import type { FanficCanonCard, FanficIdeaCard } from "../src/fanfic/idea-parser.js";
import type { FanficShortPlan } from "../src/fanfic/short-planner.js";
import type { ModelEndpoint } from "../src/models.js";

const IDEA: FanficIdeaCard = {
  source: "示例恋歌",
  relationship: "沈知晚 x 陆承舟",
  timeline: "第二季结尾后",
  divergence: "陆承舟离开王都前一晚",
  tropes: ["未寄出的信", "雨夜共伞"],
  dislikes: ["突然告白", "恋爱脑"],
  rating: "清水",
  targetWordCount: 100,
  ending: "开放式 HE",
  requiredScenes: ["藏在书页里的旧信", "长廊雨声"],
  summary: "两个人在离别前确认彼此没有说出口的心意。",
  rawIdea: "原始创意",
};

const CANON: FanficCanonCard = {
  source: "示例恋歌",
  constraints: ["陆承舟习惯克制"],
  characterNotes: ["沈知晚敏锐但不会逼问"],
  timelineNotes: ["陆承舟离开前只剩一夜"],
  risks: ["不要破坏陆承舟一贯自持"],
  rawIdea: "原始创意",
};

const PLAN: FanficShortPlan = {
  title: "雨停前的旧信",
  logline: "一封未寄出的信让两人在离别前确认克制的心意。",
  premise: "雨夜里，沈知晚发现陆承舟从未寄出的信。",
  emotionalArc: { from: "试探", to: "克制确认", turningPoint: "长廊共伞时她看见他肩头淋湿" },
  scenes: [
    { order: 1, title: "旧信被发现", purpose: "引出未说出口的心意", wordBudget: 25, beats: ["沈知晚在书页里发现旧信", "长廊雨声压住翻页声"], requiredScenes: ["藏在书页里的旧信", "长廊雨声"], canonConstraints: ["沈知晚不会逼问"], emotionalTurn: "疑心转为心软", narrativeStrategy: strategy("半贴身", ["旧信", "长廊雨声"]) },
    { order: 2, title: "廊下相遇", purpose: "让两人回避又靠近", wordBudget: 25, beats: ["陆承舟出现", "两人都不点破旧信"], requiredScenes: [], canonConstraints: ["陆承舟习惯克制"], emotionalTurn: "克制升温", narrativeStrategy: strategy("全知克制", ["灯影", "衣袖"]) },
    { order: 3, title: "雨夜共伞", purpose: "用行动替代告白", wordBudget: 25, beats: ["他把伞偏向她", "她看见他肩头淋湿"], requiredScenes: [], canonConstraints: ["不要破坏陆承舟一贯自持"], emotionalTurn: "明白但不说破", narrativeStrategy: strategy("旁观", ["伞沿", "肩头湿痕"]) },
    { order: 4, title: "信留书页", purpose: "开放式 HE 收束", wordBudget: 25, beats: ["她把信放回书页", "次日离别留下余味"], requiredScenes: [], canonConstraints: ["离开前只剩一夜"], emotionalTurn: "离别中保留希望", narrativeStrategy: strategy("半贴身", ["书页", "雨停后的檐声"]) }
  ],
  requiredSceneCoverage: [
    { requiredScene: "藏在书页里的旧信", sceneTitle: "旧信被发现" },
    { requiredScene: "长廊雨声", sceneTitle: "旧信被发现" }
  ],
  avoidChecks: ["避免突然告白", "避免恋爱脑", "不破坏陆承舟一贯自持"],
  endingStrategy: "开放式 HE：两人明白彼此，但把确认留给离别后的回信。",
  writerNotes: ["用动作和物件承载情绪", "不要让角色直接剖白"],
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

function endpointWithDraft(text: string): ModelEndpoint {
  return {
    model: "test-model",
    provider: "openai-compatible",
    client: {
      messages: {
        create: vi.fn().mockResolvedValue({ content: [{ type: "text", text }] }),
      },
    } as unknown as ModelEndpoint["client"],
  };
}

const validDraft = [
  "# 雨停前的旧信",
  "",
  "藏在书页里的旧信被雨气润得微微发皱。沈知晚没有追问，只听长廊雨声一层层落下来。陆承舟站在灯影外，仍旧克制地垂着眼。",
  "他把伞偏向她，自己的肩头很快湿了一片。她看见了，却也没有点破，只把那封旧信重新夹回书页。",
  "天亮前，他们谁都没有把话说尽。雨停时，信还在原处，像一场尚未寄出的回答。"
].join("\n");

describe("fanfic writer", () => {
  it("builds a writer context pack from confirmed artifacts", () => {
    const context = buildFanficWriterContext(IDEA, CANON, PLAN);

    expect(context.targetWordCount).toBe(100);
    expect(context.requiredScenes).toEqual(IDEA.requiredScenes);
    expect(context.plan.scenes[0].beats).toContain("沈知晚在书页里发现旧信");
    expect(context.writerInstructions.join("\n")).toContain("旧信被发现");
    expect(context.writerInstructions.join("\n")).toContain("旧信、长廊雨声");
    expect(context.writerInstructions.join("\n")).toContain("不解释真正心意");
    expect(context.avoidChecks).toContain("避免突然告白");
  });

  it("drafts markdown that satisfies the Phase 4 contract", async () => {
    const context = buildFanficWriterContext(IDEA, CANON, PLAN);
    const draft = await draftFanficShortStory(context, { endpoint: endpointWithDraft(validDraft) });

    expect(draft).toContain("# 雨停前的旧信");
    expect(draft).toContain("藏在书页里的旧信");
    expect(draft).toContain("长廊雨声");
  });

  it("accepts required scenes expressed through core scene signals", async () => {
    const context = buildFanficWriterContext(IDEA, CANON, PLAN);
    const draft = [
      "# 雨停前",
      "",
      "那封信笺藏在书页之间，被雨气润得微微发皱。沈知晚没有追问，只听长廊雨声一层层落下来。",
      "陆承舟站在灯影外，仍旧克制地垂着眼。他把伞偏向她，自己的肩头很快湿了一片。",
      "天亮前，他们谁都没有把话说尽。雨停时，信还在原处，像一场尚未寄出的回答。"
    ].join("\n");

    await expect(draftFanficShortStory(context, { endpoint: endpointWithDraft(draft) }))
      .resolves.toContain("信笺藏在书页之间");
  });

  it("accepts short required scenes with core character coverage", async () => {
    const context = buildFanficWriterContext({ ...IDEA, requiredScenes: ["伞偏向她"] }, CANON, PLAN);
    const draft = [
      "# 雨停前",
      "",
      "陆承舟没有解释，只把伞面倾向她那一侧，雨水顺着自己的肩线落下。",
      "她听见长廊雨声，也看见那封信仍夹在书页之间。",
      "他们谁都没有把话说尽，只在雨停前互相点了点头。"
    ].join("\n");

    await expect(draftFanficShortStory(context, { endpoint: endpointWithDraft(draft) }))
      .resolves.toContain("伞面倾向她");
  });

  it("asks the model to preserve required scene phrases", async () => {
    const context = buildFanficWriterContext(IDEA, CANON, PLAN);
    const endpoint = endpointWithDraft(validDraft);

    await draftFanficShortStory(context, { endpoint });

    const create = endpoint.client.messages.create as unknown as { mock: { calls: Array<[unknown]> } };
    const request = create.mock.calls[0]?.[0] as { messages: Array<{ content: string }> };
    expect(request.messages[0].content).toContain("requiredScenes 中的每个原文短语");
    expect(request.messages[0].content).toContain("narrativeStrategy");
    expect(request.messages[0].content).toContain("情绪如何被看见");
  });

  it("rejects a draft that misses required scenes", async () => {
    const context = buildFanficWriterContext(IDEA, CANON, PLAN);
    await expect(draftFanficShortStory(context, { endpoint: endpointWithDraft("# 草稿\n只有雨，没有旧信。") }))
      .rejects.toThrow(/required scene/i);
  });
});
