import { describe, it, expect, vi } from "vitest";
import { planFanficShortStory } from "../src/fanfic/short-planner.js";
import type { FanficCanonCard, FanficIdeaCard } from "../src/fanfic/idea-parser.js";
import type { ModelEndpoint } from "../src/models.js";

const IDEA: FanficIdeaCard = {
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
};

const CANON: FanficCanonCard = {
  source: "示例恋歌",
  constraints: ["陆承舟习惯克制"],
  characterNotes: ["沈知晚敏锐但不会逼问"],
  timelineNotes: ["陆承舟离开前只剩一夜"],
  risks: ["不要破坏陆承舟一贯自持"],
  rawIdea: "原始创意",
};

function endpointWithPlan(plan: unknown): ModelEndpoint {
  return {
    model: "test-model",
    provider: "openai-compatible",
    client: {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: JSON.stringify(plan) }],
        }),
      },
    } as unknown as ModelEndpoint["client"],
  };
}

const validPlan = {
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

describe("fanfic short planner", () => {
  it("plans 4-5 scenes with beats and coverage for every required scene", async () => {
    const plan = await planFanficShortStory(IDEA, CANON, { endpoint: endpointWithPlan(validPlan) });

    expect(plan.title).toBe("雨停前的旧信");
    expect(plan.scenes).toHaveLength(4);
    expect(plan.scenes[0].beats).toContain("沈知晚在书页里发现旧信");
    expect(plan.requiredSceneCoverage.map((item) => item.requiredScene)).toEqual(IDEA.requiredScenes);
    expect(plan.avoidChecks.join(" ")).toContain("突然告白");
    expect(plan.avoidChecks.join(" ")).toContain("恋爱脑");
  });

  it("accepts avoid checks that cover a dislike with semantic signals", async () => {
    const idea = { ...IDEA, dislikes: ["直白表达情感"] };
    const plan = {
      ...validPlan,
      avoidChecks: ["避免直白剖白，用动作和物件承载情感"],
    };

    await expect(planFanficShortStory(idea, CANON, { endpoint: endpointWithPlan(plan) }))
      .resolves.toMatchObject({ title: validPlan.title });
  });

  it("rejects a plan that does not cover required scenes", async () => {
    const invalidPlan = { ...validPlan, requiredSceneCoverage: [{ requiredScene: "藏在书页里的旧信", sceneTitle: "旧信被发现" }] };

    await expect(planFanficShortStory(IDEA, CANON, { endpoint: endpointWithPlan(invalidPlan) }))
      .rejects.toThrow(/required scene/i);
  });
});
