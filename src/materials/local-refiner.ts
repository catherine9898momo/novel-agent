import type {
  CharacterMaterial,
  CorrectedCharacterMaterial,
  CorrectedCharacterRole,
  CorrectedPlotThreadMaterial,
  PlotThreadMaterial,
} from "./types.js";
import type {
  CharacterRefinementInput,
  CharacterRefinementOutput,
  MaterialRefiner,
  PlotThreadRefinementInput,
  PlotThreadRefinementOutput,
} from "./refiner.js";

export class LocalHeuristicMaterialRefiner implements MaterialRefiner {
  async refineCharacters(input: CharacterRefinementInput): Promise<CharacterRefinementOutput> {
    return {
      characters: input.characters.map(toCorrectedCharacter),
      rejectedCandidates: [],
      notes: ["local heuristic correction: preserves existing decomposer aliases and normalizes schema"],
    };
  }

  async refinePlotThreads(input: PlotThreadRefinementInput): Promise<PlotThreadRefinementOutput> {
    const canonicalNames = new Map<string, string>();
    for (const character of input.characters) {
      canonicalNames.set(character.name, character.name);
      for (const alias of character.aliases) {
        canonicalNames.set(alias, character.name);
      }
    }

    return {
      plotThreads: input.plotThreads.map((thread) => toCorrectedPlotThread(thread, canonicalNames)),
      notes: ["local heuristic correction: expands plot thread schema for review and planning"],
    };
  }
}

function toCorrectedCharacter(character: CharacterMaterial): CorrectedCharacterMaterial {
  return {
    name: character.name,
    aliases: character.aliases,
    role: mapRole(character),
    function: character.roleGuess,
    motivation: character.desireGuess,
    relationships: [],
    evidence: character.evidence,
    sourceCharacterNames: [character.name, ...character.aliases],
  };
}

function toCorrectedPlotThread(
  thread: PlotThreadMaterial,
  canonicalNames: Map<string, string>,
): CorrectedPlotThreadMaterial {
  return {
    id: thread.id,
    title: thread.title,
    kind: thread.kind,
    chapters: thread.chapters,
    chapterNumbers: thread.chapterNumbers,
    involvedCharacters: unique(thread.involvedCharacters.map((name) => canonicalNames.get(name) ?? name)),
    background: thread.background,
    summary: thread.summary,
    keyEvents: thread.keyEvents,
    outcome: thread.outcome,
    storyFunction: thread.payoff || thread.promise,
    readerPull: thread.readerPulls.join("；"),
    evidence: [thread.summary, thread.background, ...thread.keyEvents].filter(Boolean),
    sourceThreadIds: [thread.id],
  };
}

function mapRole(character: CharacterMaterial): CorrectedCharacterRole {
  if (character.importance === "lead") return "lead";
  if (character.importance === "key_relationship") return "love_interest";
  if (character.importance === "minor") return "minor";
  if (character.roleGuess.includes("反派")) return "antagonist";
  return "supporting";
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
