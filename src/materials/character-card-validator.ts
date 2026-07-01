import type {
  CharacterCard,
  CharacterCardReviewIssue,
  CharacterCardValidationContext,
  CharacterCardValidationResult,
} from "./character-card-schema.js";

const GENERIC_VALUES = new Set([
  "在压力中争取主动权",
  "证明自身能力并掌握命运",
  "外部评价和目标阻碍",
]);

const TRUNCATED_ALIAS_REPAIRS = new Map([
  ["公主殿", "公主殿下"],
  ["大长公", "大长公主"],
]);

export function validateCharacterCards(
  cards: CharacterCard[],
  context: CharacterCardValidationContext,
): { cards: CharacterCard[]; reviewIssues: CharacterCardReviewIssue[] } {
  const validCards: CharacterCard[] = [];
  const reviewIssues: CharacterCardReviewIssue[] = [];

  for (const card of cards) {
    const result = validateCharacterCard(card, context);
    reviewIssues.push(...result.issues);
    if (result.card && isReadyForMaterialPool(result.card, result.issues)) {
      validCards.push(result.card);
    }
  }

  return { cards: validCards, reviewIssues };
}

export function validateCharacterCard(
  card: CharacterCard,
  context: CharacterCardValidationContext,
): CharacterCardValidationResult {
  const issues: CharacterCardReviewIssue[] = [];
  const aliases = validateAliases(card, context, issues);
  const relationshipDynamics = card.relationshipDynamics.filter((relationship) => {
    if (relationship.target === card.canonicalName) {
      issues.push({
        code: "relationship_self_reference",
        characterName: card.canonicalName,
        message: `relationship target cannot be the same as canonicalName: ${relationship.target}`,
        value: relationship,
      });
      return false;
    }
    return true;
  });

  if (card.sceneEvidence.length === 0) {
    issues.push({
      code: "missing_evidence",
      characterName: card.canonicalName,
      message: "character card must have at least one sceneEvidence item",
    });
  }

  if (
    card.reuseGuidance.canBorrow.length === 0
    || card.reuseGuidance.doNotCopy.length === 0
    || !card.reuseGuidance.planningUse.trim()
  ) {
    issues.push({
      code: "missing_reuse_guidance",
      characterName: card.canonicalName,
      message: "character card must explain how it can be reused and what must not be copied",
    });
  }

  for (const [field, value] of [
    ["narrativeFunction", card.narrativeFunction],
    ["coreDesire", card.coreDesire],
    ["corePressure", card.corePressure],
    ["strategy", card.strategy],
  ] as const) {
    if (!value.trim() || GENERIC_VALUES.has(value.trim())) {
      issues.push({
        code: "generic_character_field",
        characterName: card.canonicalName,
        message: `${field} is empty or too generic for a reusable material card`,
        value,
      });
    }
  }

  return {
    card: {
      ...card,
      aliases,
      relationshipDynamics,
    },
    issues,
  };
}

function validateAliases(
  card: CharacterCard,
  context: CharacterCardValidationContext,
  issues: CharacterCardReviewIssue[],
): string[] {
  const rawNameSet = new Set(context.rawNames);
  const normalized = new Set<string>();

  for (const alias of card.aliases) {
    const repaired = TRUNCATED_ALIAS_REPAIRS.get(alias);
    if (repaired) {
      issues.push({
        code: "alias_truncated",
        characterName: card.canonicalName,
        message: `removed truncated alias ${alias}; use ${repaired} when supported by evidence`,
        value: alias,
      });
      if (context.originalText.includes(repaired) || rawNameSet.has(repaired)) {
        normalized.add(repaired);
      }
      continue;
    }

    const supportedByCanonicalName = alias.length >= 2 && card.canonicalName.includes(alias);
    if (
      !rawNameSet.has(alias)
      && alias !== card.canonicalName
      && !supportedByCanonicalName
      && !context.originalText.includes(alias)
    ) {
      issues.push({
        code: "alias_not_supported",
        characterName: card.canonicalName,
        message: `alias is not supported by raw names or exact evidence: ${alias}`,
        value: alias,
      });
      continue;
    }
    normalized.add(alias);
  }

  normalized.delete(card.canonicalName);
  return Array.from(normalized);
}

function isReadyForMaterialPool(card: CharacterCard, issues: CharacterCardReviewIssue[]): boolean {
  const blocking = new Set<CharacterCardReviewIssue["code"]>([
    "missing_evidence",
    "missing_reuse_guidance",
    "generic_character_field",
  ]);
  return issues.every((issue) => !blocking.has(issue.code))
    && card.sceneEvidence.length > 0
    && card.reuseGuidance.canBorrow.length > 0
    && card.reuseGuidance.doNotCopy.length > 0
    && Boolean(card.reuseGuidance.planningUse.trim());
}
