import type {
  ChapterChainItem,
  CharacterMaterial,
  CorrectedCharacterMaterial,
  PlotThreadMaterial,
} from "./types.js";

export interface RefinerPrompt {
  system: string;
  user: string;
}

export interface CharacterRefinementPromptInput {
  characters: CharacterMaterial[];
  plotThreads: PlotThreadMaterial[];
  chapterChain: ChapterChainItem[];
}

export interface PlotThreadRefinementPromptInput {
  plotThreads: PlotThreadMaterial[];
  characters: CorrectedCharacterMaterial[];
  chapterChain: ChapterChainItem[];
}

export function buildCharacterRefinementPrompt(input: CharacterRefinementPromptInput): RefinerPrompt {
  return {
    system: [
      "You are a novel material correction layer.",
      "Return strict JSON only. Do not include markdown.",
      "Correct character candidates by merging aliases, removing title-only false positives, and preserving evidence.",
    ].join(" "),
    user: JSON.stringify({
      task: "refine_characters",
      outputSchema: {
        characters: [{
          name: "canonical character name",
          aliases: ["title/name variants"],
          role: "lead | love_interest | supporting | antagonist | minor",
          function: "story function in one concise Chinese sentence",
          motivation: "character motivation inferred from evidence",
          relationships: ["name: dynamic"],
          evidence: ["short source evidence"],
          sourceCharacterNames: ["raw candidate names merged into this character"],
        }],
        rejectedCandidates: ["raw names rejected as title-only/noise"],
        notes: ["correction notes"],
      },
      constraints: [
        "长公主/大长公主/殿下这类称谓如果证据指向同一人，必须合并到 canonical name。",
        "梅大人/梅长生/小字这类称呼如果证据指向同一人，必须合并。",
        "evidence must come from input snippets or chapter chain, not invented facts.",
      ],
      input,
    }, null, 2),
  };
}

export function buildPlotThreadRefinementPrompt(input: PlotThreadRefinementPromptInput): RefinerPrompt {
  return {
    system: [
      "You are a novel plot-thread correction layer.",
      "Return strict JSON only. Do not include markdown.",
      "Rewrite thread summaries into reviewable story materials with background, event chain, outcome, function, and reader pull.",
    ].join(" "),
    user: JSON.stringify({
      task: "refine_plot_threads",
      outputSchema: {
        plotThreads: [{
          id: "source or stable thread id",
          title: "clear Chinese thread title",
          kind: "main | phase | subplot | mini_arc",
          chapters: "chapter range",
          chapterNumbers: [1],
          involvedCharacters: ["canonical names"],
          background: "who is under what situation before the events",
          summary: "who does what under what pressure and how it changes the story",
          keyEvents: ["ordered event beats"],
          outcome: "state change after the thread",
          storyFunction: "why this thread exists in the whole book",
          readerPull: "why readers keep reading after this thread",
          evidence: ["source evidence"],
          sourceThreadIds: ["raw thread ids merged here"],
        }],
        notes: ["correction notes"],
      },
      constraints: [
        "summary must include involved characters, situation, action, and state change.",
        "background cannot be a generic chapter label only.",
        "readerPull should explain attraction mechanics, not just repeat hook words.",
      ],
      input,
    }, null, 2),
  };
}
