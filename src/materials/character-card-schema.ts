export interface RelationshipDynamicCard {
  target: string;
  targetId?: string;
  targetName?: string;
  dynamic: string;
  tension: string;
  usablePattern: string;
}

export interface SceneEvidence {
  chapter: number;
  quote: string;
  supports: string;
}

export interface ReuseGuidance {
  canBorrow: string[];
  doNotCopy: string[];
  planningUse: string;
  usableAsPromptContext?: string;
}

export interface CharacterCardSourceRef {
  sourceId: string;
  chapterRange: string;
  chapterNumbers: number[];
}

export interface CharacterCardConfidence {
  ruleScore: number;
  llmScore: number | null;
  llmModel: string | null;
  reasons: string[];
  llmReasons: string[] | null;
}

export interface CharacterCard {
  id?: string;
  materialType?: "character";
  canonicalName: string;
  aliases: string[];
  sourceRef?: CharacterCardSourceRef;
  roleInStory: string;
  narrativeFunction: string;
  coreDesire: string;
  corePressure: string;
  strategy: string;
  relationshipDynamics: RelationshipDynamicCard[];
  sceneEvidence: SceneEvidence[];
  borrowableElements?: string[];
  reuseGuidance: ReuseGuidance;
  tags?: string[];
  confidence?: CharacterCardConfidence;
  qualityFlags?: string[];
}

export type CharacterCardReviewIssueCode =
  | "alias_truncated"
  | "alias_not_supported"
  | "relationship_self_reference"
  | "missing_evidence"
  | "missing_reuse_guidance"
  | "generic_character_field"
  | "candidate_not_character"
  | "candidate_duplicate_alias"
  | "low_rule_score";

export interface CharacterCardReviewIssue {
  code: CharacterCardReviewIssueCode;
  characterName: string;
  message: string;
  value?: unknown;
}

export interface CharacterCardValidationContext {
  originalText: string;
  rawNames: string[];
}

export interface CharacterCardValidationResult {
  card?: CharacterCard;
  issues: CharacterCardReviewIssue[];
}

export interface CharacterCardQualityMetrics {
  candidateCount: number;
  acceptedCardCount: number;
  rejectedCandidateCount: number;
  noiseRejectionCount: number;
  duplicateAliasMergeCount: number;
  relationshipTargetValidityRate: number;
  averageEvidenceCount: number;
  averageBorrowableElementCount: number;
}

export interface CharacterCardGenerationSummary {
  sourceId: string;
  chapterRange: string;
  createdAt: string;
  cardCount: number;
  reviewIssueCount: number;
  metrics: CharacterCardQualityMetrics;
}

export interface CharacterCardArtifactPaths {
  cards: string;
  preview: string;
  qualityReport: string;
  reviewIssues: string;
  summary: string;
}
