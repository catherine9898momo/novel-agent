import type {
  CorrectedCharacterMaterial,
  CorrectedPlotThreadMaterial,
  MaterialBrief,
} from "./types.js";

export interface ComposeMaterialBriefInput {
  sourceId: string;
  idea: string;
  characters: CorrectedCharacterMaterial[];
  plotThreads: CorrectedPlotThreadMaterial[];
  now?: () => string;
}

export function composeMaterialBrief(input: ComposeMaterialBriefInput): MaterialBrief {
  return {
    sourceId: input.sourceId,
    idea: input.idea,
    createdAt: input.now?.() ?? new Date().toISOString(),
    planningOnly: true,
    characterSeeds: input.characters.map((character) => ({
      name: character.name,
      function: character.function,
      motivation: character.motivation,
      usablePattern: buildCharacterPattern(character),
    })),
    relationshipDynamics: unique(input.characters.flatMap((character) => character.relationships)),
    plotStructures: input.plotThreads.map((thread) => `${thread.title}：${thread.storyFunction}。${thread.summary}`),
    highPoints: unique(input.plotThreads.flatMap((thread) => [
      ...thread.keyEvents,
      thread.outcome,
    ]).filter(Boolean)),
    chapterHooks: unique(input.plotThreads.map((thread) => thread.readerPull).filter(Boolean)),
    safetyNotes: [
      "materialBrief 仅用于 planning，不直接进入 drafting/review。",
      "借鉴人物功能、关系动力和剧情结构，不复用原文表达或专有设定组合。",
    ],
  };
}

function buildCharacterPattern(character: CorrectedCharacterMaterial): string {
  const aliasNote = character.aliases.length > 0 ? `称谓/别名用于识别同一人物：${character.aliases.join("、")}。` : "";
  return `${character.function}；动机是${character.motivation}。${aliasNote}`.trim();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
