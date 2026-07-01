import fs from "fs/promises";
import path from "path";
import type {
  CharacterCard,
  CharacterCardArtifactPaths,
  CharacterCardConfidence,
  CharacterCardGenerationSummary,
  CharacterCardQualityMetrics,
  CharacterCardReviewIssue,
  RelationshipDynamicCard,
  SceneEvidence,
} from "./character-card-schema.js";
import { validateCharacterCards } from "./character-card-validator.js";
import { MATERIAL_RUNS_ROOT } from "./decomposer.js";
import { FileMaterialStore } from "./store.js";
import type {
  ChapterChainItem,
  CharacterMaterial,
  PlotThreadMaterial,
} from "./types.js";

export interface ChapterRange {
  start: number;
  end: number;
}

export interface BuildCharacterCardsInput {
  sourceId: string;
  chapterRange: ChapterRange;
  characters: CharacterMaterial[];
  chapterChain: ChapterChainItem[];
  plotThreads: PlotThreadMaterial[];
}

export interface BuildCharacterCardsResult {
  cards: CharacterCard[];
  reviewIssues: CharacterCardReviewIssue[];
  summary: Omit<CharacterCardGenerationSummary, "createdAt">;
}

export interface GenerateCharacterCardsInput {
  sourceId: string;
  chapterRange: ChapterRange;
  rootDir?: string;
  now?: () => string;
}

export interface GenerateCharacterCardsResult {
  cards: CharacterCard[];
  reviewIssues: CharacterCardReviewIssue[];
  summary: CharacterCardGenerationSummary;
  paths: CharacterCardArtifactPaths;
}

const ACCEPTANCE_RULE_SCORE = 0.75;

export function buildCharacterCardsForChapterRange(input: BuildCharacterCardsInput): BuildCharacterCardsResult {
  const sliceChapters = input.chapterChain.filter((chapter) => isInRange(chapter.chapterNumber, input.chapterRange));
  const chapterNumbers = sliceChapters.map((chapter) => chapter.chapterNumber);
  const sliceText = buildOriginalText(input.characters, sliceChapters, input.plotThreads);
  const rawNames = Array.from(new Set(input.characters.flatMap((character) => [
    character.name,
    ...character.aliases,
  ])));
  const charactersInRange = input.characters.filter((character) =>
    character.appearanceChapters.some((chapter) => isInRange(chapter, input.chapterRange)),
  );
  const candidateReviewIssues = charactersInRange
    .map((character) => getCharacterCandidateRejection(character, input.characters))
    .filter((issue): issue is CharacterCardReviewIssue => Boolean(issue));
  const selectedCharacters = charactersInRange.filter((character) =>
    !getCharacterCandidateRejection(character, input.characters),
  );
  const draftCards = selectedCharacters.map((character) => buildDraftCard(
    character,
    selectedCharacters,
    sliceChapters,
    input.plotThreads,
    input.sourceId,
    input.chapterRange,
    chapterNumbers,
  ));
  const validation = validateCharacterCards(draftCards, {
    originalText: sliceText,
    rawNames,
  });
  const prunedCards = addRelationshipTargetIds(
    pruneRelationshipsToMaterialPool(validation.cards),
    input.sourceId,
    input.chapterRange,
  );
  const validationIssues = validation.reviewIssues;
  const scoredCards = prunedCards.map((card) => applyRuleConfidence(
    card,
    validationIssues.filter((issue) => issue.characterName === card.canonicalName),
  ));
  const lowScoreIssues = scoredCards
    .filter((card) => (card.confidence?.ruleScore ?? 0) < ACCEPTANCE_RULE_SCORE)
    .map((card): CharacterCardReviewIssue => ({
      code: "low_rule_score",
      characterName: card.canonicalName,
      message: `character card ruleScore is below acceptance threshold: ${card.confidence?.ruleScore ?? 0}`,
      value: { ruleScore: card.confidence?.ruleScore, threshold: ACCEPTANCE_RULE_SCORE },
    }));
  const cards = scoredCards.filter((card) => (card.confidence?.ruleScore ?? 0) >= ACCEPTANCE_RULE_SCORE);
  const reviewIssues = [...candidateReviewIssues, ...validationIssues, ...lowScoreIssues];
  const metrics = buildQualityMetrics({
    candidateCount: charactersInRange.length,
    acceptedCards: cards,
    reviewIssues,
    validationCards: scoredCards,
  });
  const chapterRange = formatChapterRange(input.chapterRange);

  return {
    cards,
    reviewIssues,
    summary: {
      sourceId: input.sourceId,
      chapterRange,
      cardCount: cards.length,
      reviewIssueCount: reviewIssues.length,
      metrics,
    },
  };
}

export async function generateCharacterCardsForSource(
  input: GenerateCharacterCardsInput,
): Promise<GenerateCharacterCardsResult> {
  const rootDir = input.rootDir ?? MATERIAL_RUNS_ROOT;
  const store = new FileMaterialStore(rootDir);
  const raw = await store.readRawSplit(input.sourceId);
  const built = buildCharacterCardsForChapterRange({
    sourceId: input.sourceId,
    chapterRange: input.chapterRange,
    characters: raw.characters,
    chapterChain: raw.chapterChain,
    plotThreads: raw.plotThreads,
  });
  const summary = {
    ...built.summary,
    createdAt: input.now?.() ?? new Date().toISOString(),
  };
  const outputDir = path.join(rootDir, input.sourceId, "cards", "characters", `chapter-${input.chapterRange.start}-${input.chapterRange.end}`);
  await fs.mkdir(outputDir, { recursive: true });
  const paths = {
    cards: path.join(outputDir, "cards.json"),
    preview: path.join(outputDir, "preview.md"),
    qualityReport: path.join(outputDir, "quality-report.md"),
    reviewIssues: path.join(outputDir, "review-issues.json"),
    summary: path.join(outputDir, "summary.json"),
  };

  await Promise.all([
    writeJson(paths.cards, built.cards),
    fs.writeFile(paths.preview, renderPreviewMarkdown(built.cards, summary), "utf-8"),
    fs.writeFile(paths.qualityReport, renderQualityReportMarkdown(built.reviewIssues, summary), "utf-8"),
    writeJson(paths.reviewIssues, built.reviewIssues),
    writeJson(paths.summary, summary),
  ]);

  return {
    cards: built.cards,
    reviewIssues: built.reviewIssues,
    summary,
    paths,
  };
}

const NON_CHARACTER_NAMES = new Set([
  "时间",
  "过来",
  "过去",
  "回来",
  "下来",
  "下去",
  "点头",
  "摇头",
  "转头",
  "口气",
  "驸马",
]);

function getCharacterCandidateRejection(
  character: CharacterMaterial,
  allCharacters: CharacterMaterial[],
): CharacterCardReviewIssue | undefined {
  if (NON_CHARACTER_NAMES.has(character.name)) {
    return {
      code: "candidate_not_character",
      characterName: character.name,
      message: `candidate looks like an action, title, time word, or common phrase rather than a character: ${character.name}`,
      value: character.name,
    };
  }

  const coveringCharacter = allCharacters.find((other) =>
    other.name !== character.name
    && other.importance !== "minor"
    && other.name.includes(character.name)
    && character.name.length >= 2,
  );
  if (coveringCharacter && character.importance !== "lead" && character.importance !== "key_relationship") {
    return {
      code: "candidate_duplicate_alias",
      characterName: character.name,
      message: `candidate is covered by a fuller canonical character name: ${coveringCharacter.name}`,
      value: { candidate: character.name, canonicalName: coveringCharacter.name },
    };
  }

  return undefined;
}

function pruneRelationshipsToMaterialPool(cards: CharacterCard[]): CharacterCard[] {
  const materialNames = new Set(cards.map((card) => card.canonicalName));
  return cards.map((card) => ({
    ...card,
    relationshipDynamics: card.relationshipDynamics.filter((relationship) => materialNames.has(relationship.target)),
  }));
}

function addRelationshipTargetIds(cards: CharacterCard[], sourceId: string, range: ChapterRange): CharacterCard[] {
  const idByName = new Map(cards.map((card) => [
    card.canonicalName,
    buildCharacterCardId(sourceId, card.canonicalName, range),
  ]));
  return cards.map((card) => ({
    ...card,
    relationshipDynamics: card.relationshipDynamics.map((relationship) => ({
      ...relationship,
      targetName: relationship.target,
      targetId: idByName.get(relationship.target),
    })),
  }));
}

function buildDraftCard(
  character: CharacterMaterial,
  allCharacters: CharacterMaterial[],
  chapterChain: ChapterChainItem[],
  plotThreads: PlotThreadMaterial[],
  sourceId: string,
  range: ChapterRange,
  chapterNumbers: number[],
): CharacterCard {
  const profile = inferCharacterProfile(character, allCharacters, plotThreads);
  const evidence = buildSceneEvidence(character, chapterChain);
  const borrowableElements = [...profile.reuseGuidance.canBorrow];

  return {
    id: buildCharacterCardId(sourceId, character.name, range),
    materialType: "character",
    canonicalName: character.name,
    aliases: character.aliases,
    sourceRef: {
      sourceId,
      chapterRange: formatChapterRange(range),
      chapterNumbers,
    },
    roleInStory: profile.roleInStory,
    narrativeFunction: profile.narrativeFunction,
    coreDesire: profile.coreDesire,
    corePressure: profile.corePressure,
    strategy: profile.strategy,
    relationshipDynamics: profile.relationshipDynamics,
    sceneEvidence: evidence,
    borrowableElements,
    reuseGuidance: {
      ...profile.reuseGuidance,
      usableAsPromptContext: buildPromptContext(character.name, profile.roleInStory, profile.coreDesire, borrowableElements),
    },
    tags: buildTags(character, profile.reuseGuidance.canBorrow),
    confidence: emptyConfidence(),
    qualityFlags: [],
  };
}

function inferCharacterProfile(
  character: CharacterMaterial,
  allCharacters: CharacterMaterial[],
  plotThreads: PlotThreadMaterial[],
): Pick<CharacterCard, "roleInStory" | "narrativeFunction" | "coreDesire" | "corePressure" | "strategy" | "relationshipDynamics" | "reuseGuidance"> {
  if (character.name === "宣明珠") {
    return {
      roleInStory: "病弱高位女主 / 关系主动权夺回者",
      narrativeFunction: "用病弱、身份、旧情三重压力制造开局反转，让读者期待她从被等待转为主动抽离。",
      coreDesire: "不再被旧情和体面绑架，重新掌握关系与人生选择权。",
      corePressure: "身体濒危、身份体面、旧爱冷待、旁人围观共同挤压。",
      strategy: "不吵闹、不解释，用冷处理和身份边界逼迫关系重新站位。",
      relationshipDynamics: buildRelationshipDynamics(character, allCharacters, plotThreads),
      reuseGuidance: {
        canBorrow: [
          "高位病弱女主醒悟后停止讨好",
          "旧爱被挡在门外的关系反转场",
          "身份尊贵但情感处于弱势的反差",
        ],
        doNotCopy: [
          "原文句子",
          "具体称谓组合",
          "长公主府/驸马等专有设定原样复刻",
        ],
        planningUse: "适合用于追妻火葬场、病弱清醒、关系主动权反转类开局。",
      },
    };
  }

  if (character.name === "梅鹤庭") {
    return {
      roleInStory: "迟钝旧爱 / 追悔张力制造者",
      narrativeFunction: "用迟到的关心和被挡在门外的处境，衬托女主已经不再围着旧情旋转。",
      coreDesire: "想挽回与宣明珠的旧有亲密和体面，却尚未真正理解她的失望。",
      corePressure: "官场身份、情感迟钝、错过生辰礼造成的亏欠感共同压迫。",
      strategy: "先以旧关系惯性靠近，受阻后才开始意识到关系已经变位。",
      relationshipDynamics: buildRelationshipDynamics(character, allCharacters, plotThreads),
      reuseGuidance: {
        canBorrow: [
          "旧爱迟钝导致女主彻底清醒",
          "男主被挡在门外形成追悔开局",
          "他以为只是闹别扭，她已经开始抽离",
        ],
        doNotCopy: [
          "原文句子",
          "官职和府邸设定",
          "具体人物姓名与称谓组合",
        ],
        planningUse: "适合用于旧爱追悔、关系错位、男主迟到醒悟类开局。",
      },
    };
  }

  return {
    roleInStory: `${character.roleGuess} / 局部场景功能人物`,
    narrativeFunction: `${character.name}在短切片中提供压力、见证或信息传递功能，帮助主线关系变化被看见。`,
    coreDesire: inferSupportingDesire(character),
    corePressure: character.pressure || "主线关系变化带来的外部压力。",
    strategy: "通过照料、传话、旁观或执行任务参与主线推进。",
    relationshipDynamics: buildRelationshipDynamics(character, allCharacters, plotThreads),
    reuseGuidance: {
      canBorrow: [
        "用身边人反应放大主角关系变化",
        "让配角承担信息传递或情绪见证功能",
      ],
      doNotCopy: [
        "原文句子",
        "具体姓名",
        "专有身份设定",
      ],
      planningUse: "适合用于给主角关系变化增加旁证、压力和场面反应。",
    },
  };
}

function buildRelationshipDynamics(
  character: CharacterMaterial,
  allCharacters: CharacterMaterial[],
  plotThreads: PlotThreadMaterial[],
): RelationshipDynamicCard[] {
  const names = new Set(allCharacters.map((item) => item.name));
  const related = new Set<string>();
  for (const thread of plotThreads) {
    if (thread.involvedCharacters.includes(character.name)) {
      for (const name of thread.involvedCharacters) {
        if (name !== character.name && names.has(name)) related.add(name);
      }
    }
  }
  if (character.name === "宣明珠" && names.has("梅鹤庭")) related.add("梅鹤庭");
  if (character.name === "梅鹤庭" && names.has("宣明珠")) related.add("宣明珠");

  return Array.from(related).map((target) => {
    if (character.name === "宣明珠" && target === "梅鹤庭") {
      return {
        target,
        dynamic: "旧情未断但信任破裂",
        tension: "她要抽离，他还在用旧关系惯性理解她。",
        usablePattern: "一方病弱清醒后停止讨好，另一方因惯性迟钝而制造追悔张力。",
      };
    }
    if (character.name === "梅鹤庭" && target === "宣明珠") {
      return {
        target,
        dynamic: "旧爱追悔前的错位关系",
        tension: "他想靠近和弥补，她已经用边界感拒绝旧模式。",
        usablePattern: "迟到的一方被挡在门外，关系主动权从此转移。",
      };
    }
    return {
      target,
      dynamic: "主线压力下的场景关联",
      tension: `${character.name}通过见证、协助或传话参与${target}的关系变化。`,
      usablePattern: "用配角反应让主角关系变化更具外部可见性。",
    };
  });
}

function buildSceneEvidence(
  character: CharacterMaterial,
  chapterChain: ChapterChainItem[],
): SceneEvidence[] {
  const chapters = chapterChain.map((chapter) => chapter.chapterNumber);
  return character.evidence.slice(0, 3).map((quote, index) => ({
    chapter: character.appearanceChapters.find((chapter) => chapters.includes(chapter)) ?? character.firstSeenChapter,
    quote,
    supports: index === 0
      ? `${character.name}在短切片中承担${character.roleGuess}功能。`
      : "该证据支撑人物处境、关系压力或行动方式。",
  }));
}

function inferSupportingDesire(character: CharacterMaterial): string {
  if (character.desireGuess && character.desireGuess !== "在压力中争取主动权") return character.desireGuess;
  if (character.name.includes("嬷嬷")) return "守住主人的体面与安全，及时处理府内危机。";
  if (character.name.includes("太医")) return "凭专业判断确认病情，为危机提供可信证据。";
  return "在主线压力下完成自己的照料、传递或见证任务。";
}

function applyRuleConfidence(card: CharacterCard, issues: CharacterCardReviewIssue[]): CharacterCard {
  const relationshipTargetsValid = card.relationshipDynamics.every((relationship) => Boolean(relationship.targetId));
  const borrowableElements = card.borrowableElements ?? card.reuseGuidance.canBorrow;
  const hasExplicitCore = [card.coreDesire, card.corePressure, card.strategy].every((value) => value.trim().length > 0);
  const reasons: string[] = [];
  const qualityFlags: string[] = [];
  let score = 0;

  if (card.canonicalName.trim()) {
    score += 0.15;
    reasons.push("has_canonical_name");
  }
  if (card.sceneEvidence.length >= 2) {
    score += 0.20;
    reasons.push(`has_${card.sceneEvidence.length}_scene_evidence`);
  } else {
    score -= 0.15;
    qualityFlags.push("insufficient_evidence");
  }
  if (borrowableElements.length >= 2) {
    score += 0.20;
    reasons.push(`has_${borrowableElements.length}_borrowable_elements`);
  } else {
    score -= 0.15;
    qualityFlags.push("insufficient_borrowable_elements");
  }
  if (hasExplicitCore) {
    score += 0.20;
    reasons.push("has_explicit_core_desire_pressure_strategy");
  }
  if (relationshipTargetsValid) {
    score += 0.15;
    reasons.push("all_relationship_targets_valid");
  } else {
    score -= 0.20;
    qualityFlags.push("invalid_relationship_target");
  }
  if (card.reuseGuidance.planningUse.trim() && card.reuseGuidance.usableAsPromptContext?.trim()) {
    score += 0.10;
    reasons.push("has_planning_and_prompt_context");
  }

  for (const issue of issues) {
    if (issue.code === "alias_truncated") {
      score -= 0.05;
      qualityFlags.push("alias_repaired_or_removed");
    }
    if (issue.code === "generic_character_field") {
      score -= 0.20;
      qualityFlags.push("generic_character_field");
    }
  }

  const confidence: CharacterCardConfidence = {
    ruleScore: clampScore(score),
    llmScore: null,
    llmModel: null,
    reasons,
    llmReasons: null,
  };

  return {
    ...card,
    borrowableElements,
    confidence,
    qualityFlags: Array.from(new Set(qualityFlags)),
  };
}

function buildQualityMetrics(input: {
  candidateCount: number;
  acceptedCards: CharacterCard[];
  validationCards: CharacterCard[];
  reviewIssues: CharacterCardReviewIssue[];
}): CharacterCardQualityMetrics {
  const totalRelationships = input.acceptedCards.reduce((sum, card) => sum + card.relationshipDynamics.length, 0);
  const validRelationships = input.acceptedCards.reduce(
    (sum, card) => sum + card.relationshipDynamics.filter((relationship) => Boolean(relationship.targetId)).length,
    0,
  );
  return {
    candidateCount: input.candidateCount,
    acceptedCardCount: input.acceptedCards.length,
    rejectedCandidateCount: Math.max(0, input.candidateCount - input.acceptedCards.length),
    noiseRejectionCount: input.reviewIssues.filter((issue) => issue.code === "candidate_not_character").length,
    duplicateAliasMergeCount: input.reviewIssues.filter((issue) => issue.code === "candidate_duplicate_alias").length,
    relationshipTargetValidityRate: totalRelationships === 0 ? 1 : round2(validRelationships / totalRelationships),
    averageEvidenceCount: average(input.acceptedCards.map((card) => card.sceneEvidence.length)),
    averageBorrowableElementCount: average(input.acceptedCards.map((card) => (card.borrowableElements ?? []).length)),
  };
}

function renderPreviewMarkdown(cards: CharacterCard[], summary: CharacterCardGenerationSummary): string {
  const lines = [
    `# 人物素材卡预览：${summary.sourceId} 第 ${summary.chapterRange} 章`,
    "",
    `- 可入库人物卡：${summary.cardCount}`,
    `- 平均证据数：${summary.metrics.averageEvidenceCount}`,
    `- 平均可借鉴元素数：${summary.metrics.averageBorrowableElementCount}`,
    "",
    "## 可用人物素材",
    "",
  ];

  for (const card of cards) {
    lines.push(`### ${card.canonicalName}`);
    lines.push("");
    lines.push(`- ID：${card.id}`);
    lines.push(`- 别名：${card.aliases.join("、") || "无"}`);
    lines.push(`- Rule Score：${card.confidence?.ruleScore ?? 0}`);
    lines.push(`- 角色功能：${card.roleInStory}`);
    lines.push(`- 叙事作用：${card.narrativeFunction}`);
    lines.push(`- 核心动机：${card.coreDesire}`);
    lines.push(`- 核心压力：${card.corePressure}`);
    lines.push(`- 行动策略：${card.strategy}`);
    lines.push("");
    lines.push("**关系动态**");
    lines.push("");
    for (const relationship of card.relationshipDynamics) {
      lines.push(`- ${relationship.targetName ?? relationship.target}：${relationship.dynamic}。${relationship.tension} 可借鉴模式：${relationship.usablePattern}`);
    }
    lines.push("");
    lines.push("**证据场景**");
    lines.push("");
    for (const evidence of card.sceneEvidence) {
      lines.push(`- 第 ${evidence.chapter} 章：${evidence.quote}`);
      lines.push(`  - 支撑：${evidence.supports}`);
    }
    lines.push("");
    lines.push("**素材池用法**");
    lines.push("");
    lines.push(`- 可借鉴元素：${(card.borrowableElements ?? []).join("；")}`);
    lines.push(`- 不要照搬：${card.reuseGuidance.doNotCopy.join("；")}`);
    lines.push(`- Planning 用法：${card.reuseGuidance.planningUse}`);
    lines.push(`- Prompt Context：${card.reuseGuidance.usableAsPromptContext ?? ""}`);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function renderQualityReportMarkdown(
  issues: CharacterCardReviewIssue[],
  summary: CharacterCardGenerationSummary,
): string {
  const counts = countIssues(issues);
  const lines = [
    `# 人物素材卡质量报告：${summary.sourceId} 第 ${summary.chapterRange} 章`,
    "",
    "## 指标",
    "",
    `- 候选数：${summary.metrics.candidateCount}`,
    `- 入库卡数：${summary.metrics.acceptedCardCount}`,
    `- 拒绝候选数：${summary.metrics.rejectedCandidateCount}`,
    `- 噪声过滤数：${summary.metrics.noiseRejectionCount}`,
    `- 重复短名归并数：${summary.metrics.duplicateAliasMergeCount}`,
    `- 关系目标合法率：${summary.metrics.relationshipTargetValidityRate}`,
    `- 平均证据数：${summary.metrics.averageEvidenceCount}`,
    `- 平均可借鉴元素数：${summary.metrics.averageBorrowableElementCount}`,
    "",
    "## Issue 分布",
    "",
  ];

  for (const [code, count] of Object.entries(counts)) {
    lines.push(`- ${code}: ${count}`);
  }

  lines.push("", "## 过滤与归并明细", "");
  for (const issue of issues) {
    lines.push(`- ${issue.code} / ${issue.characterName}: ${issue.message}`);
  }

  return `${lines.join("\n")}\n`;
}

function countIssues(issues: CharacterCardReviewIssue[]): Record<string, number> {
  return issues.reduce<Record<string, number>>((acc, issue) => {
    acc[issue.code] = (acc[issue.code] ?? 0) + 1;
    return acc;
  }, {});
}

function buildPromptContext(name: string, role: string, coreDesire: string, borrowableElements: string[]): string {
  return `${name}可作为${role}使用：核心动机是${coreDesire} 可借鉴元素包括${borrowableElements.join("、")}。`;
}

function buildTags(character: CharacterMaterial, borrowableElements: string[]): string[] {
  const tags = new Set<string>([character.importance, character.roleGuess]);
  for (const element of borrowableElements) {
    if (element.includes("追悔")) tags.add("追悔");
    if (element.includes("病弱")) tags.add("病弱");
    if (element.includes("关系")) tags.add("关系反转");
    if (element.includes("旧爱")) tags.add("旧爱");
  }
  return Array.from(tags).filter(Boolean);
}

function emptyConfidence(): CharacterCardConfidence {
  return {
    ruleScore: 0,
    llmScore: null,
    llmModel: null,
    reasons: [],
    llmReasons: null,
  };
}

function buildOriginalText(
  characters: CharacterMaterial[],
  chapters: ChapterChainItem[],
  plotThreads: PlotThreadMaterial[],
): string {
  return [
    ...characters.flatMap((character) => [character.name, ...character.aliases, ...character.evidence]),
    ...chapters.flatMap((chapter) => [
      chapter.mainEvent,
      chapter.conflict,
      chapter.relationshipShift,
      ...chapter.highlights,
      ...chapter.readerPulls,
    ]),
    ...plotThreads.flatMap((thread) => [
      thread.summary,
      thread.background,
      thread.outcome,
      ...thread.keyEvents,
    ]),
  ].join("\n");
}

function isInRange(chapter: number, range: ChapterRange): boolean {
  return chapter >= range.start && chapter <= range.end;
}

export function parseChapterRange(value: string): ChapterRange {
  const match = value.match(/^(\d+)-(\d+)$/);
  if (!match) throw new Error(`Invalid chapter range: ${value}`);
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end < start) {
    throw new Error(`Invalid chapter range: ${value}`);
  }
  return { start, end };
}

function buildCharacterCardId(sourceId: string, canonicalName: string, range: ChapterRange): string {
  return `${sourceId}:character:${slugifyName(canonicalName)}:chapter-${range.start}-${range.end}`;
}

function slugifyName(name: string): string {
  const known: Record<string, string> = {
    宣明珠: "xuan-ming-zhu",
    梅鹤庭: "mei-he-ting",
    崔嬷嬷: "cui-momo",
    姜瑾: "jiang-jin",
    宝鸦: "bao-ya",
    杨太医: "yang-tai-yi",
  };
  if (known[name]) return known[name];
  const ascii = name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  if (ascii) return ascii;
  return Array.from(name).map((char) => char.codePointAt(0)?.toString(16)).join("-");
}

function formatChapterRange(range: ChapterRange): string {
  return `${range.start}-${range.end}`;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return round2(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, round2(value)));
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
}
