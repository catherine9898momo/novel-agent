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
      ...plan.writerNotes,
    ],
  };
}
