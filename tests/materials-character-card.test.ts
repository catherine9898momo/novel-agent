import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import path from "path";
import {
  buildCharacterCardsForChapterRange,
  generateCharacterCardsForSource,
} from "../src/materials/character-card.js";
import {
  validateCharacterCard,
  validateCharacterCards,
} from "../src/materials/character-card-validator.js";
import type {
  CharacterCard,
  CharacterCardReviewIssue,
} from "../src/materials/character-card-schema.js";
import type {
  ChapterChainItem,
  CharacterMaterial,
  MaterialSource,
  PlotThreadMaterial,
} from "../src/materials/types.js";

const ROOT = path.resolve("materials/_test_character_cards");
const source: MaterialSource = {
  id: "sample-book",
  title: "样例书",
  importedAt: "2026-06-28T00:00:00.000Z",
  wordCount: 1000,
  chapterCount: 2,
};

beforeEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
  await fs.mkdir(path.join(ROOT, source.id, "split"), { recursive: true });
});

afterEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
});

describe("character card validation", () => {
  it("removes truncated aliases while keeping exact usable aliases", () => {
    const card = baseCard({
      aliases: ["明珠", "长公主", "大长公主", "大长公", "殿下", "公主殿", "公主殿下"],
      sceneEvidence: [
        {
          chapter: 1,
          quote: "公主殿下不开门，大长公主只把旧信放下。",
          supports: "称谓指向宣明珠。",
        },
      ],
    });

    const result = validateCharacterCard(card, {
      originalText: "公主殿下不开门，大长公主只把旧信放下。",
      rawNames: ["宣明珠", "长公主", "大长公主", "公主殿下"],
    });

    expect(result.card?.aliases).toEqual(["明珠", "长公主", "大长公主", "殿下", "公主殿下"]);
    expect(result.issues.map((issue) => issue.code)).toContain("alias_truncated");
    expect(result.issues.some((issue) => issue.message.includes("公主殿"))).toBe(true);
  });

  it("removes self-referential relationships and reports them for review", () => {
    const card = baseCard({
      canonicalName: "梅鹤庭",
      relationshipDynamics: [
        {
          target: "梅鹤庭",
          dynamic: "旧情破裂",
          tension: "错误自指。",
          usablePattern: "不可用。",
        },
      ],
    });

    const result = validateCharacterCard(card, {
      originalText: "梅鹤庭站在门外。",
      rawNames: ["梅鹤庭"],
    });

    expect(result.card?.relationshipDynamics).toEqual([]);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "relationship_self_reference" }),
    ]));
  });

  it("moves cards without evidence or reuse guidance into review issues", () => {
    const card = baseCard({
      sceneEvidence: [],
      reuseGuidance: {
        canBorrow: [],
        doNotCopy: [],
        planningUse: "",
      },
    });

    const result = validateCharacterCards([card], {
      originalText: "宣明珠醒来。",
      rawNames: ["宣明珠"],
    });

    expect(result.cards).toHaveLength(0);
    expect(result.reviewIssues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "missing_evidence",
      "missing_reuse_guidance",
    ]));
  });

  it("flags generic motivation and strategy as not ready for the material pool", () => {
    const card = baseCard({
      coreDesire: "在压力中争取主动权",
      strategy: "在压力中争取主动权",
    });

    const result = validateCharacterCards([card], {
      originalText: "宣明珠醒来。",
      rawNames: ["宣明珠"],
    });

    expect(result.cards).toHaveLength(0);
    expect(result.reviewIssues.map((issue) => issue.code)).toContain("generic_character_field");
  });
});

describe("buildCharacterCardsForChapterRange", () => {
  it("builds reusable cards for the first two chapters instead of a flat character table", () => {
    const result = buildCharacterCardsForChapterRange({
      sourceId: "sample-book",
      chapterRange: { start: 1, end: 2 },
      characters: [
        character("宣明珠", ["明珠", "长公主", "大长公主", "大长公", "殿下", "公主殿", "公主殿下"], "lead", [
          "宴会的后半场，作为寿星的宣明珠没再露面。",
          "公主殿下不开门，梅鹤庭被挡在外面。",
        ]),
        character("梅鹤庭", ["长生", "梅长生", "梅大人"], "key_relationship", [
          "梅鹤庭站在门外。",
          "他没有为宣明珠准备生辰礼。",
        ]),
        {
          ...character("口气", [], "supporting", ["他的口气冷下来。"]),
          desireGuess: "想控制场面节奏",
          pressure: "当场冲突正在升级",
        },
        {
          ...character("鹤庭", [], "supporting", ["鹤庭站在门外。"]),
          desireGuess: "想靠近旧人",
          pressure: "旧情关系被阻断",
        },
      ],
      chapterChain: [
        chapter(1, "宣明珠病醒后缺席寿宴，梅鹤庭被挡在门外。"),
        chapter(2, "梅鹤庭意识到宣明珠不再等待。"),
      ],
      plotThreads: [
        plotThread(),
        {
          ...plotThread(),
          id: "noise-thread",
          involvedCharacters: ["宣明珠", "梅鹤庭", "口气", "鹤庭"],
        },
      ],
    });

    const names = result.cards.map((card) => card.canonicalName);
    expect(names).toEqual(expect.arrayContaining(["宣明珠", "梅鹤庭"]));
    const princess = result.cards.find((card) => card.canonicalName === "宣明珠");
    const mei = result.cards.find((card) => card.canonicalName === "梅鹤庭");
    expect(princess?.aliases).not.toContain("大长公");
    expect(princess?.aliases).not.toContain("公主殿");
    expect(princess?.coreDesire).toContain("旧情");
    expect(princess?.reuseGuidance.canBorrow.join("\n")).toContain("停止讨好");
    expect(mei?.coreDesire).toContain("挽回");
    expect(mei?.relationshipDynamics.some((item) => item.target === "梅鹤庭")).toBe(false);
    expect(mei?.sceneEvidence.length).toBeGreaterThan(0);
    expect(names).not.toContain("口气");
    expect(names).not.toContain("鹤庭");
    expect(result.cards.flatMap((card) => card.relationshipDynamics.map((item) => item.target))).not.toEqual(
      expect.arrayContaining(["口气", "鹤庭"]),
    );
    expect(result.reviewIssues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "candidate_not_character",
      "candidate_duplicate_alias",
    ]));
  });
});

describe("generateCharacterCardsForSource", () => {
  it("writes reviewable card artifacts by chapter range", async () => {
    await writeSplit("characters", [
      character("宣明珠", ["长公主", "大长公主", "公主殿"], "lead", [
        "宴会的后半场，作为寿星的宣明珠没再露面。",
        "公主殿下不开门，梅鹤庭被挡在外面。",
      ]),
      character("梅鹤庭", ["梅大人", "梅长生"], "key_relationship", [
        "梅鹤庭站在门外。",
        "他没有为宣明珠准备生辰礼。",
      ]),
      {
        ...character("口气", [], "supporting", ["他的口气冷下来。"]),
        desireGuess: "想控制场面节奏",
        pressure: "当场冲突正在升级",
      },
    ]);
    await writeSplit("chapter_chain", [chapter(1, "宣明珠缺席寿宴。"), chapter(2, "梅鹤庭被挡在门外。")], "chapter-chain.json");
    await writeSplit("plot_threads", [plotThread()], "plot-threads.json");

    const result = await generateCharacterCardsForSource({
      sourceId: source.id,
      rootDir: ROOT,
      chapterRange: { start: 1, end: 2 },
      now: () => "2026-06-28T00:00:00.000Z",
    });

    expect(result.paths.cards).toBe(path.join(ROOT, source.id, "cards", "characters", "chapter-1-2", "cards.json"));
    expect(result.paths.preview).toBe(path.join(ROOT, source.id, "cards", "characters", "chapter-1-2", "preview.md"));
    expect(result.paths.qualityReport).toBe(path.join(ROOT, source.id, "cards", "characters", "chapter-1-2", "quality-report.md"));
    await expect(fs.stat(result.paths.cards)).resolves.toBeTruthy();
    await expect(fs.stat(result.paths.reviewIssues)).resolves.toBeTruthy();
    await expect(fs.stat(result.paths.summary)).resolves.toBeTruthy();
    await expect(fs.stat(result.paths.preview)).resolves.toBeTruthy();
    await expect(fs.stat(result.paths.qualityReport)).resolves.toBeTruthy();

    const cards = JSON.parse(await fs.readFile(result.paths.cards, "utf-8"));
    const summary = JSON.parse(await fs.readFile(result.paths.summary, "utf-8"));
    const preview = await fs.readFile(result.paths.preview, "utf-8");
    const qualityReport = await fs.readFile(result.paths.qualityReport, "utf-8");

    expect(cards.map((card: CharacterCard) => card.canonicalName)).toContain("宣明珠");
    expect(cards.map((card: CharacterCard) => card.canonicalName)).not.toContain("口气");
    expect(summary.cardCount).toBe(cards.length);
    expect(summary.metrics.acceptedCardCount).toBe(cards.length);
    expect(summary.metrics.noiseRejectionCount).toBeGreaterThanOrEqual(1);
    expect(summary.metrics.relationshipTargetValidityRate).toBe(1);

    const princess = cards.find((card: CharacterCard) => card.canonicalName === "宣明珠");
    expect(princess.id).toBe("sample-book:character:xuan-ming-zhu:chapter-1-2");
    expect(princess.materialType).toBe("character");
    expect(princess.sourceRef.chapterNumbers).toEqual([1, 2]);
    expect(princess.borrowableElements.length).toBeGreaterThanOrEqual(2);
    expect(princess.reuseGuidance.usableAsPromptContext).toContain("宣明珠");
    expect(princess.confidence.ruleScore).toBeGreaterThanOrEqual(0.75);
    expect(princess.confidence.llmScore).toBeNull();
    expect(princess.confidence.llmModel).toBeNull();

    expect(preview).toContain("# 人物素材卡预览");
    expect(preview).toContain("宣明珠");
    expect(preview).not.toContain("candidate_not_character");
    expect(qualityReport).toContain("# 人物素材卡质量报告");
    expect(qualityReport).toContain("candidate_not_character");
  });
});

function baseCard(overrides: Partial<CharacterCard> = {}): CharacterCard {
  return {
    canonicalName: "宣明珠",
    aliases: ["明珠", "长公主"],
    roleInStory: "病弱高位女主 / 关系主动权夺回者",
    narrativeFunction: "用病弱、身份、旧情三重压力制造开局反转。",
    coreDesire: "不再被旧情和体面绑架，重新掌握关系与人生选择权。",
    corePressure: "身体濒危、身份体面、旧爱冷待、旁人围观共同挤压。",
    strategy: "不吵闹、不解释，用冷处理和身份边界逼迫关系重新站位。",
    relationshipDynamics: [
      {
        target: "梅鹤庭",
        dynamic: "旧情未断但信任破裂",
        tension: "她要抽离，他还在用旧关系惯性理解她。",
        usablePattern: "一方病弱清醒后停止讨好，另一方迟钝制造追悔张力。",
      },
    ],
    sceneEvidence: [
      {
        chapter: 1,
        quote: "宴会的后半场，作为寿星的宣明珠没再露面。",
        supports: "她身体/情绪异常，开局形成缺席悬念。",
      },
    ],
    reuseGuidance: {
      canBorrow: ["高位病弱女主醒悟后停止讨好"],
      doNotCopy: ["原文句子", "具体称谓组合"],
      planningUse: "适合用于追妻火葬场、病弱清醒、关系主动权反转类开局。",
    },
    ...overrides,
  };
}

function character(
  name: string,
  aliases: string[],
  importance: CharacterMaterial["importance"],
  evidence: string[],
): CharacterMaterial {
  return {
    name,
    aliases,
    roleGuess: importance === "lead" ? "核心主角" : "关键关系对象",
    importance,
    mentionCount: 3,
    appearanceChapters: [1, 2],
    desireGuess: "在压力中争取主动权",
    pressure: "外部评价和目标阻碍",
    firstSeenChapter: 1,
    evidence,
  };
}

function chapter(chapterNumber: number, mainEvent: string): ChapterChainItem {
  return {
    chapterNumber,
    title: chapterNumber === 1 ? "觉" : "悟",
    function: "建立开局关系反转",
    mainEvent,
    conflict: "病弱、身份、旧情冷待共同施压。",
    relationshipShift: "从等待转向抽离。",
    highlights: ["被挡在门外", "停止讨好"],
    readerPulls: ["期待旧爱追悔"],
    hookOut: "她不再等他。",
    reusablePattern: "病弱高位女主醒悟后，用边界感制造追悔开局。",
  };
}

function plotThread(): PlotThreadMaterial {
  return {
    id: "mini-arc-1",
    title: "病醒后与旧情决裂",
    kind: "mini_arc",
    chapters: "第 1-2 章",
    chapterNumbers: [1, 2],
    involvedCharacters: ["宣明珠", "梅鹤庭"],
    summary: "宣明珠醒来后看清梅鹤庭的迟钝，开始抽离关系。",
    background: "寿宴和病弱状态把旧情矛盾推到台前。",
    keyEvents: ["缺席寿宴", "被挡门外"],
    outcome: "关系主动权发生反转。",
    promise: "追悔与反击",
    conflict: "旧情迟钝与女主清醒",
    payoff: "女主停止讨好",
    readerPulls: ["期待梅鹤庭追悔"],
    childThreadIds: [],
  };
}

async function writeSplit(collection: string, items: unknown[], fileName = `${collection}.json`): Promise<void> {
  await fs.writeFile(
    path.join(ROOT, source.id, "split", fileName),
    JSON.stringify({ schemaVersion: 1, source, collection, count: items.length, items }, null, 2),
    "utf-8",
  );
}
