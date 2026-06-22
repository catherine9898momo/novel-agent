import type { FanficCanonCard, FanficIdeaCard } from "./idea-parser.js";
import type { FanficShortPlan } from "./short-planner.js";

export interface FanficWriterContext {
  idea: FanficIdeaCard;
  canon: FanficCanonCard;
  plan: FanficShortPlan;
  targetWordCount: number;
  rating: string;
  requiredScenes: string[];
  avoidChecks: string[];
  writerInstructions: string[];
}

export function buildFanficWriterContext(
  idea: FanficIdeaCard,
  canon: FanficCanonCard,
  plan: FanficShortPlan,
): FanficWriterContext {
  return {
    idea,
    canon,
    plan,
    targetWordCount: idea.targetWordCount,
    rating: idea.rating,
    requiredScenes: idea.requiredScenes,
    avoidChecks: [...idea.dislikes.map((item) => "避免" + item), ...plan.avoidChecks],
    writerInstructions: [
      "按 plan.scenes 顺序推进，不要跳过 beats。",
      "用动作、物件和场景细节表达情绪，避免直白剖白。",
      "必须覆盖 requiredScenes，并遵守 canon.constraints。",
      "输出 Markdown 正文，不要附加解释。",
      ...buildNarrativeStrategyInstructions(plan),
      ...plan.writerNotes,
    ],
  };
}


function buildNarrativeStrategyInstructions(plan: FanficShortPlan): string[] {
  const instructions = [
    "短篇默认叙事基线：每场先处理 narrativeStrategy，回答情绪如何被看见；少解释、多动作、多物件、多留白。",
  ];

  for (const scene of plan.scenes) {
    const strategy = scene.narrativeStrategy ?? buildDefaultNarrativeStrategy(scene);
    instructions.push([
      `Scene ${scene.order}「${scene.title}」narrativeStrategy：${strategy.purpose}`,
      `- 叙事距离：${strategy.viewpointDistance}。`,
      `- 情绪载体：${strategy.emotionCarriers.join("、")}。`,
      `- 表层信号：${strategy.surfaceSignals.join("、")}。`,
      `- 留白禁区：${strategy.withheldInterior.join("、")}。`,
      `- 反俗套动作：${strategy.antiClicheMoves.join("、")}。`,
      `- 收束方式：${strategy.closingMove}。`,
    ].join("\n"));
  }

  return instructions;
}

function buildDefaultNarrativeStrategy(scene: FanficShortPlan["scenes"][number]) {
  const carriers = [...scene.requiredScenes, ...scene.beats.slice(0, 2)].filter(Boolean);
  return {
    purpose: `让「${scene.title}」的${scene.emotionalTurn}通过可见细节被读者看见，而不是由作者解释。`,
    viewpointDistance: "半贴身",
    emotionCarriers: carriers.length > 0 ? carriers : [scene.title],
    surfaceSignals: ["停顿", "视线", "手上动作", "环境声"],
    withheldInterior: ["不解释真正心意", "不替读者总结关系"],
    antiClicheMoves: ["避免直白心理", "避免金句式煽情", "避免俗套比喻"],
    closingMove: "用动作、物件或日常一句话克制收束。",
  };
}
