import fs from "fs/promises";
import path from "path";
import type {
  BookPhase,
  CharacterMaterial,
  ChapterChainItem,
  DecomposeNovelTextInput,
  NovelMaterialDecomposition,
  PlotThreadMaterial,
  RelationshipArcMaterial,
  ReusableMaterial,
  SaveMaterialOptions,
  SavedMaterialPaths,
} from "./types.js";

export const MATERIAL_RUNS_ROOT = "materials/runs";

interface ParsedChapter {
  chapterNumber: number;
  title: string;
  content: string;
}

export function decomposeNovelText(input: DecomposeNovelTextInput): NovelMaterialDecomposition {
  const text = normalizeText(input.text);
  if (!text) {
    throw new Error("decomposeNovelText requires non-empty text");
  }

  const chapters = splitChapters(text);
  const rawCharacterNames = extractCharacterNames(chapters);
  const aliasMap = inferCharacterAliasMap(text, rawCharacterNames);
  const characterNames = mergeCharacterNames(rawCharacterNames, aliasMap);
  const chapterChain = chapters.map((chapter) => buildChapterChainItem(chapter, characterNames));
  const characters = buildCharacterMaterials(chapters, characterNames, aliasMap);
  const relationshipArcs = buildRelationshipArcs(chapters, chapterChain, characterNames, aliasMap);
  const plotThreads = buildPlotThreads(chapterChain, characterNames);
  const bookStructure = {
    corePromise: buildCorePromise(input.title, characters, chapterChain),
    openingHook: chapterChain[0]?.hookOut ?? "开局通过人物困境制造继续阅读期待。",
    mainThroughline: buildMainThroughline(chapterChain),
    phaseArcs: buildPhaseArcs(chapterChain),
  };
  const reusableMaterials = buildReusableMaterials(chapterChain, characters, relationshipArcs);

  return {
    schemaVersion: 1,
    source: {
      id: input.sourceId,
      title: input.title,
      sourcePath: input.sourcePath,
      importedAt: input.importedAt ?? new Date().toISOString(),
      wordCount: countContentChars(text),
      chapterCount: chapters.length,
    },
    bookStructure,
    characters,
    relationshipArcs,
    plotThreads,
    chapterChain,
    reusableMaterials,
    reviewChecklist: [
      "检查 bookStructure 的 corePromise 是否准确概括这本书给读者的承诺。",
      "检查 chapterChain 是否覆盖主要章节功能。",
      "检查 highlights 和 readerPulls 是否是抽象机制，而不是照搬原文。",
      "检查 relationshipArcs 是否能看出关系推进，而不只是人物同框。",
      "检查 reusableMaterials 是否可迁移到新故事，且不依赖原文表达。",
    ],
  };
}

export function formatMaterialReviewMarkdown(result: NovelMaterialDecomposition): string {
  return [
    `# ${result.source.title} 素材拆解 Review`,
    "",
    `- source_id: ${result.source.id}`,
    `- 字数: ${result.source.wordCount}`,
    `- 章节数: ${result.source.chapterCount}`,
    "",
    "## 整书结构",
    "",
    `- 核心承诺：${result.bookStructure.corePromise}`,
    `- 开局钩子：${result.bookStructure.openingHook}`,
    `- 主线推进：${result.bookStructure.mainThroughline}`,
    "",
    "### 阶段弧线",
    "",
    ...result.bookStructure.phaseArcs.map((phase) => [
      `- ${phase.chapters}：${phase.function}`,
      `  - 冲突：${phase.mainConflict}`,
      `  - 情绪：${phase.readerEmotion.join("、")}`,
      `  - 回报：${phase.payoff}`,
    ].join("\n")),
    "",
    "## 人物素材",
    "",
    ...result.characters.map((character) => [
      `- ${character.name}（${character.roleGuess}）`,
      ...(character.aliases.length > 0 ? [`  - 别名：${character.aliases.join("、")}`] : []),
      `  - 欲望猜测：${character.desireGuess}`,
      `  - 压力来源：${character.pressure}`,
      `  - 首次出现：第 ${character.firstSeenChapter} 章`,
    ].join("\n")),
    "",
    "## 关系线",
    "",
    ...result.relationshipArcs.map((arc) => [
      `- ${arc.characters.join(" / ")}`,
      `  - 初始关系：${arc.initialDynamic}`,
      `  - 张力：${arc.tension}`,
      `  - 可复用模式：${arc.usablePattern}`,
      `  - 转折点：${arc.turningPoints.join("；")}`,
    ].join("\n")),
    "",
    "## 剧情线",
    "",
    ...result.plotThreads.map((thread) => [
      `- [${thread.kind}] ${thread.title}（${thread.chapters}）`,
      `  - 概括：${thread.summary}`,
      `  - 背景：${thread.background}`,
      `  - 关键事件：${thread.keyEvents.join("；")}`,
      `  - 结果：${thread.outcome}`,
      `  - 读者钩子：${thread.readerPulls.join("；")}`,
      `  - 子线：${thread.childThreadIds.join("、") || "无"}`,
    ].join("\n")),
    "",
    "## 章节链路",
    "",
    ...result.chapterChain.map((chapter) => [
      `### 第 ${chapter.chapterNumber} 章：${chapter.title}`,
      "",
      `- 功能：${chapter.function}`,
      `- 主事件：${chapter.mainEvent}`,
      `- 冲突：${chapter.conflict}`,
      `- 关系变化：${chapter.relationshipShift}`,
      `- 高光：${chapter.highlights.join("；")}`,
      `- 读者钩子：${chapter.readerPulls.join("；")}`,
      `- 章末欠账：${chapter.hookOut}`,
      `- 可复用模式：${chapter.reusablePattern}`,
    ].join("\n")),
    "",
    "## 可复用素材",
    "",
    ...result.reusableMaterials.map((item) => [
      `- [${item.kind}] ${item.label}`,
      `  - 模式：${item.pattern}`,
      `  - 标签：${item.tags.join("、")}`,
      `  - 来源章节：${item.sourceChapters.join("、")}`,
      `  - 版权安全：${item.copyrightSafeNote}`,
    ].join("\n")),
    "",
    "## Review Checklist",
    "",
    ...result.reviewChecklist.map((item) => `- [ ] ${item}`),
    "",
  ].join("\n");
}

export async function saveMaterialDecomposition(
  result: NovelMaterialDecomposition,
  options: SaveMaterialOptions = {},
): Promise<SavedMaterialPaths> {
  const rootDir = options.rootDir ?? MATERIAL_RUNS_ROOT;
  const runDir = path.join(rootDir, result.source.id);
  await fs.mkdir(runDir, { recursive: true });

  const jsonPath = path.join(runDir, "decomposition.json");
  const reviewPath = path.join(runDir, "review.md");
  const splitDir = path.join(runDir, "split");
  const reusableByKindDir = path.join(splitDir, "reusable-by-kind");
  await fs.mkdir(reusableByKindDir, { recursive: true });

  const splitPaths = {
    source: path.join(splitDir, "source.json"),
    bookStructure: path.join(splitDir, "book-structure.json"),
    characters: path.join(splitDir, "characters.json"),
    relationships: path.join(splitDir, "relationships.json"),
    plotThreads: path.join(splitDir, "plot-threads.json"),
    chapterChain: path.join(splitDir, "chapter-chain.json"),
    reusableMaterials: path.join(splitDir, "reusable-materials.json"),
    reusableByKindDir,
  };

  await fs.writeFile(jsonPath, JSON.stringify(result, null, 2), "utf-8");
  await fs.writeFile(reviewPath, formatMaterialReviewMarkdown(result), "utf-8");
  await writeSplitJson(splitPaths.source, result, "source", result.source);
  await writeSplitJson(splitPaths.bookStructure, result, "book_structure", result.bookStructure);
  await writeSplitJson(splitPaths.characters, result, "characters", result.characters);
  await writeSplitJson(splitPaths.relationships, result, "relationships", result.relationshipArcs);
  await writeSplitJson(splitPaths.plotThreads, result, "plot_threads", result.plotThreads);
  await writeSplitJson(splitPaths.chapterChain, result, "chapter_chain", result.chapterChain);
  await writeSplitJson(splitPaths.reusableMaterials, result, "reusable_materials", result.reusableMaterials);
  await writeReusableMaterialsByKind(reusableByKindDir, result);

  return { jsonPath, reviewPath, splitDir, splitPaths };
}

async function writeSplitJson(
  filePath: string,
  result: NovelMaterialDecomposition,
  collection: string,
  value: unknown,
): Promise<void> {
  const isArray = Array.isArray(value);
  const payload = {
    schemaVersion: result.schemaVersion,
    source: result.source,
    collection,
    count: isArray ? value.length : 1,
    ...(isArray ? { items: value } : { data: value }),
  };
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");
}

async function writeReusableMaterialsByKind(
  dir: string,
  result: NovelMaterialDecomposition,
): Promise<void> {
  const byKind = new Map<string, ReusableMaterial[]>();
  for (const material of result.reusableMaterials) {
    const items = byKind.get(material.kind) ?? [];
    items.push(material);
    byKind.set(material.kind, items);
  }

  for (const [kind, items] of byKind.entries()) {
    await writeSplitJson(path.join(dir, kind + ".json"), result, "reusable_materials." + kind, items);
  }
}

function splitChapters(text: string): ParsedChapter[] {
  const chapterHeader = /(?:^|\n)\s*((?:第[一二三四五六七八九十百千零〇两\d]+[章节回][^\n]*)|(?:\d{1,4}[.．、]\s*[^\n]{1,80}))\n/g;
  const matches = [...text.matchAll(chapterHeader)];
  if (matches.length === 0) {
    return [{ chapterNumber: 1, title: "全文", content: text.trim() }];
  }

  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? text.length;
    const header = match[1].trim();
    return {
      chapterNumber: index + 1,
      title: normalizeChapterTitle(header),
      content: text.slice(start, end).trim(),
    };
  }).filter((chapter) => chapter.content.length > 0);
}

function normalizeChapterTitle(header: string): string {
  return header
    .replace(/^第[一二三四五六七八九十百千零〇两\d]+[章节回]\s*[:：、.-]?/, "")
    .replace(/^\d{1,4}[.．、]\s*/, "")
    .trim() || header.trim();
}

function buildChapterChainItem(chapter: ParsedChapter, names: string[]): ChapterChainItem {
  const sentences = splitSentences(chapter.content);
  const chapterNames = names.filter((name) => chapter.content.includes(name));
  const mainEvent = sentences[0] ?? `${chapter.title}中推进新的情节节点。`;
  const conflict = findSentence(chapter.content, CONFLICT_SIGNALS) ?? inferConflict(chapter.content);
  const highlights = findSentences(chapter.content, HIGHLIGHT_SIGNALS, 2);
  const readerPulls = inferReaderPulls(chapter.content, highlights, conflict);
  const hookOut = sentences[sentences.length - 1] ?? readerPulls[0] ?? "留下下一章的行动或信息欠账。";

  return {
    chapterNumber: chapter.chapterNumber,
    title: chapter.title,
    function: inferChapterFunction(chapter.chapterNumber, chapter.content),
    mainEvent,
    conflict,
    relationshipShift: inferRelationshipShift(chapter.content, chapterNames),
    highlights: highlights.length > 0 ? highlights : [inferHighlight(chapter.content)],
    readerPulls,
    hookOut,
    reusablePattern: inferReusablePattern(chapter.content),
  };
}

function inferCharacterAliasMap(text: string, names: string[]): Map<string, string[]> {
  const aliasMap = new Map<string, Set<string>>();
  const addAlias = (canonical: string, alias: string) => {
    if (!canonical || !alias || canonical === alias) return;
    if (!aliasMap.has(canonical)) aliasMap.set(canonical, new Set<string>());
    aliasMap.get(canonical)?.add(alias);
  };

  for (const match of text.matchAll(/([\u4e00-\u9fa5]{1,3})[，,]?是([\u4e00-\u9fa5]{2,3})的小字/g)) {
    const courtesy = normalizeNameCandidate(match[1]);
    const canonical = normalizeNameCandidate(match[2]);
    addAlias(canonical, courtesy);
    addAlias(canonical, canonical[0] + courtesy);
  }

  for (const name of names) {
    if (name.length !== 3 || ["太医", "嬷嬷", "阁老", "大人"].some((suffix) => name.endsWith(suffix)) || isAliasAssigned(aliasMap, name)) continue;
    const shortName = name.slice(1);
    if (text.includes(shortName) && !COMMON_WORDS.has(shortName)) addAlias(name, shortName);
  }

  const knownAliasToCanonical = new Map<string, string>();
  for (const [canonical, aliases] of aliasMap.entries()) {
    knownAliasToCanonical.set(canonical, canonical);
    for (const alias of aliases) knownAliasToCanonical.set(alias, canonical);
  }

  const honorifics = [...new Set(names.map((name) => name[0] + "大人"))];
  for (const honorific of honorifics) {
    if (!text.includes(honorific) || isAliasAssigned(aliasMap, honorific)) continue;
    const canonical = names
      .map((name) => knownAliasToCanonical.get(name) ?? name)
      .filter((name, index, all) => all.indexOf(name) === index)
      .filter((name) => name[0] === honorific[0])
      .sort((a, b) => firstTextIndex(text, [a, ...(aliasMap.get(a) ? [...(aliasMap.get(a) ?? [])] : [])]) - firstTextIndex(text, [b, ...(aliasMap.get(b) ? [...(aliasMap.get(b) ?? [])] : [])]))[0];
    if (canonical) addAlias(canonical, honorific);
  }

  for (const [canonical, aliases] of aliasMap.entries()) {
    const honorific = canonical[0] + "大人";
    if (!text.includes(honorific)) continue;
    if ([...aliases].some((alias) => alias.startsWith(canonical[0]) && alias.length >= 3)) {
      moveAlias(aliasMap, canonical, honorific);
    }
  }

  const titleCanonical = names.find((name) => !TITLE_ALIASES.has(name) && !name.endsWith("大人") && !name.includes("长生") && !name.startsWith("梅"));
  if (titleCanonical) {
    for (const title of TITLE_ALIASES) {
      if (text.includes(title)) addAlias(titleCanonical, title);
    }
  }

  const result = new Map<string, string[]>();
  for (const [canonical, aliases] of aliasMap.entries()) {
    result.set(canonical, [...aliases]);
  }
  return result;
}

function moveAlias(aliasMap: Map<string, Set<string>>, canonical: string, alias: string): void {
  for (const aliases of aliasMap.values()) {
    aliases.delete(alias);
  }
  if (!aliasMap.has(canonical)) aliasMap.set(canonical, new Set<string>());
  aliasMap.get(canonical)?.add(alias);
}

function firstTextIndex(text: string, names: string[]): number {
  const indexes = names.map((name) => text.indexOf(name)).filter((index) => index >= 0);
  return indexes.length > 0 ? Math.min(...indexes) : Number.MAX_SAFE_INTEGER;
}

function isAliasAssigned(aliasMap: Map<string, Set<string>>, alias: string): boolean {
  for (const aliases of aliasMap.values()) {
    if (aliases.has(alias)) return true;
  }
  return false;
}

function mergeCharacterNames(names: string[], aliasMap: Map<string, string[]>): string[] {
  const aliasToCanonical = new Map<string, string>();
  for (const [canonical, aliases] of aliasMap.entries()) {
    aliasToCanonical.set(canonical, canonical);
    for (const alias of aliases) aliasToCanonical.set(alias, canonical);
  }

  const merged: string[] = [];
  for (const name of names) {
    const canonical = aliasToCanonical.get(name) ?? name;
    if (TITLE_ALIASES.has(name) && canonical === name) continue;
    if (!merged.includes(canonical)) merged.push(canonical);
  }
  for (const canonical of aliasMap.keys()) {
    if (TITLE_ALIASES.has(canonical)) continue;
    if (!merged.includes(canonical)) merged.push(canonical);
  }
  return merged;
}

function hasMention(text: string, names: string[]): boolean {
  return names.some((name) => text.includes(name));
}

function buildCharacterMaterials(
  chapters: ParsedChapter[],
  names: string[],
  aliasMap: Map<string, string[]>,
): CharacterMaterial[] {
  return names.slice(0, 40).map((name, index) => {
    const aliases = aliasMap.get(name) ?? [];
    const mentionNames = [name, ...aliases];
    const appearances = chapters.filter((chapter) => hasMention(chapter.content, mentionNames));
    const mentionCount = countMentions(chapters.map((chapter) => chapter.content).join("\n"), mentionNames);
    const appearanceChapters = appearances.map((chapter) => chapter.chapterNumber);
    const evidence = appearances
      .flatMap((chapter) => splitSentences(chapter.content).filter((sentence) => hasMention(sentence, mentionNames)).slice(0, 1))
      .slice(0, 3);
    return {
      name,
      aliases,
      roleGuess: inferCharacterRole(index, appearances.length),
      importance: inferCharacterImportance(index, appearances.length),
      mentionCount,
      appearanceChapters,
      desireGuess: inferDesire(evidence.join("")),
      pressure: inferPressure(evidence.join("")),
      firstSeenChapter: appearances[0]?.chapterNumber ?? 1,
      evidence,
    };
  });
}

function countMentions(text: string, names: string[]): number {
  let count = 0;
  for (const name of names) {
    let index = text.indexOf(name);
    while (index !== -1) {
      count += 1;
      index = text.indexOf(name, index + name.length);
    }
  }
  return count;
}

function inferCharacterImportance(
  index: number,
  chapterAppearances: number,
): CharacterMaterial["importance"] {
  if (index === 0) return "lead";
  if (index === 1) return "key_relationship";
  if (chapterAppearances >= 2 || index < 12) return "supporting";
  return "minor";
}

function inferCharacterRole(index: number, chapterAppearances: number): string {
  const importance = inferCharacterImportance(index, chapterAppearances);
  if (importance === "lead") return "核心主角";
  if (importance === "key_relationship") return "关键关系对象";
  if (importance === "supporting") return "配角/支线角色";
  return "次要出场人物";
}

function buildRelationshipArcs(
  chapters: ParsedChapter[],
  chapterChain: ChapterChainItem[],
  names: string[],
  aliasMap: Map<string, string[]>,
): RelationshipArcMaterial[] {
  if (names.length < 2) return [];
  const lead = names[0];
  const leadMentions = [lead, ...(aliasMap.get(lead) ?? [])];
  const partner = names.slice(1)
    .map((name) => ({
      name,
      count: chapters.filter((chapter) => hasMention(chapter.content, leadMentions) && hasMention(chapter.content, [name, ...(aliasMap.get(name) ?? [])])).length,
    }))
    .sort((a, b) => b.count - a.count)[0]?.name ?? names[1];
  const pair = [lead, partner];
  const turningPoints = chapterChain
    .filter((chapter) => pair.some((name) => chapter.mainEvent.includes(name) || chapter.relationshipShift.includes(name)))
    .slice(0, 5)
    .map((chapter) => `第 ${chapter.chapterNumber} 章：${chapter.relationshipShift}`);

  return [{
    characters: pair,
    initialDynamic: "一方承受压力或误解，另一方与危机、保护、试探或利益绑定有关。",
    tension: "外部冲突推动两人被迫重新评估彼此，关系推进常常晚于行动。",
    turningPoints: turningPoints.length > 0 ? turningPoints : ["早期通过同场事件建立关系张力。"],
    usablePattern: "从误解/防备出发，用暗中相助、共同危机或公开高光推动信任变化。",
  }];
}

function buildPlotThreads(
  chapterChain: ChapterChainItem[],
  characterNames: string[],
): PlotThreadMaterial[] {
  if (chapterChain.length === 0) return [];
  const threads: PlotThreadMaterial[] = [];
  const phaseGroups = chunkChapters(chapterChain, Math.max(1, Math.ceil(chapterChain.length / 3)));
  const miniGroupSize = chapterChain.length <= 20 ? 1 : Math.max(2, Math.min(8, Math.ceil(chapterChain.length / 12)));
  const miniGroups = chunkChapters(chapterChain, miniGroupSize);
  const miniThreads = miniGroups.map((group, index) => buildThreadFromChapters(
    "mini-arc-" + (index + 1),
    "mini_arc",
    summarizeThreadTitle(group, "小故事"),
    group,
    characterNames,
    [],
  ));
  const phaseThreads = phaseGroups.map((group, index) => {
    const childIds = miniThreads
      .filter((thread) => thread.chapterNumbers.some((num) => group.some((chapter) => chapter.chapterNumber === num)))
      .map((thread) => thread.id);
    return buildThreadFromChapters(
      "phase-" + (index + 1),
      "phase",
      summarizeThreadTitle(group, index === 0 ? "开局阶段" : index === 1 ? "推进阶段" : "回报阶段"),
      group,
      characterNames,
      childIds,
    );
  });
  const mainThread = buildThreadFromChapters(
    "main",
    "main",
    "整本主线",
    chapterChain,
    characterNames,
    phaseThreads.map((thread) => thread.id),
  );
  threads.push(mainThread, ...phaseThreads, ...miniThreads);
  return threads;
}

function buildThreadFromChapters(
  id: string,
  kind: PlotThreadMaterial["kind"],
  title: string,
  chapters: ChapterChainItem[],
  characterNames: string[],
  childThreadIds: string[],
): PlotThreadMaterial {
  const text = chapters.map((chapter) => [chapter.title, chapter.mainEvent, chapter.conflict, chapter.relationshipShift, chapter.hookOut].join(" ")).join(" ");
  const involvedCharacters = characterNames.filter((name) => text.includes(name)).slice(0, 8);
  const promise = chapters[0]?.function ?? "承接故事目标并推进阶段变化";
  const conflict = chapters.find((chapter) => chapter.conflict)?.conflict ?? "阶段冲突继续推进";
  const payoff = chapters.flatMap((chapter) => chapter.highlights)[0] ?? "阶段性情绪回报";
  const keyEvents = buildThreadKeyEvents(chapters);
  const background = buildThreadBackground(chapters, involvedCharacters);
  const outcome = buildThreadOutcome(chapters, payoff, involvedCharacters);

  return {
    id,
    title,
    kind,
    chapters: formatChapterRange(chapters),
    chapterNumbers: chapters.map((chapter) => chapter.chapterNumber),
    involvedCharacters,
    summary: buildThreadSummary(title, chapters, involvedCharacters, background, keyEvents, outcome),
    background,
    keyEvents,
    outcome,
    promise,
    conflict,
    payoff,
    readerPulls: [...new Set(chapters.flatMap((chapter) => chapter.readerPulls))].slice(0, 8),
    childThreadIds,
  };
}

function buildThreadBackground(chapters: ChapterChainItem[], characters: string[]): string {
  const first = chapters[0];
  const people = characters.length > 0 ? characters.slice(0, 4).join("、") : "相关人物";
  const chapterRange = formatChapterRange(chapters);
  const setup = first?.mainEvent ?? first?.function ?? "故事进入新的阶段";
  return "在" + chapterRange + "，" + people + "处在「" + setup + "」的情境中，故事围绕" + (first?.function ?? "阶段目标") + "展开。";
}

function buildThreadKeyEvents(chapters: ChapterChainItem[]): string[] {
  const events = chapters.map((chapter) => {
    const event = trimSentence(chapter.mainEvent || chapter.conflict || chapter.function);
    const shift = trimSentence(chapter.relationshipShift);
    return "第 " + chapter.chapterNumber + " 章：" + event + (shift ? "；" + shift : "");
  });
  return events.slice(0, 6);
}

function buildThreadOutcome(
  chapters: ChapterChainItem[],
  payoff: string,
  characters: string[],
): string {
  const last = chapters[chapters.length - 1];
  const people = characters.length > 0 ? characters.slice(0, 3).join("、") : "人物关系";
  const hook = trimSentence(last?.hookOut ?? "留下新的悬念");
  return "这一段通过「" + payoff + "」给出阶段性回报，让" + people + "的处境发生变化，并在结尾留下「" + hook + "」作为下一段牵引。";
}

function buildThreadSummary(
  title: string,
  chapters: ChapterChainItem[],
  characters: string[],
  background: string,
  keyEvents: string[],
  outcome: string,
): string {
  const people = characters.length > 0 ? characters.slice(0, 5).join("、") : "相关人物";
  const firstEvent = keyEvents[0]?.replace(/^第 \d+ 章：/, "") ?? chapters[0]?.mainEvent ?? "故事进入新阶段";
  return title + "：" + background + people + "先经历「" + trimSentence(firstEvent) + "」，随后围绕" + (chapters.length > 1 ? "连续事件" : "单章事件") + "推进。" + outcome;
}

function trimSentence(text: string): string {
  return text.replace(/\s+/g, " ").replace(/[。！？!?]+$/g, "").trim();
}

function summarizeThreadTitle(chapters: ChapterChainItem[], fallback: string): string {
  const first = chapters[0];
  if (!first) return fallback;
  const title = first.title.replace(/[~－-]/g, "").trim();
  return title ? fallback + "：" + title : fallback + "：第 " + first.chapterNumber + " 章起";
}

function buildCorePromise(
  title: string,
  characters: CharacterMaterial[],
  chapters: ChapterChainItem[],
): string {
  const lead = characters[0]?.name ?? "主角";
  const firstConflict = chapters[0]?.conflict ?? "开局困境";
  const firstHighlight = chapters.find((chapter) => chapter.highlights.length > 0)?.highlights[0] ?? "后续反击";
  return `${title}承诺读者看到${lead}从「${firstConflict}」进入故事，并通过「${firstHighlight}」持续获得情绪回报。`;
}

function buildMainThroughline(chapters: ChapterChainItem[]): string {
  const functions = chapters.slice(0, 6).map((chapter) => `第${chapter.chapterNumber}章${chapter.function}`);
  return functions.length > 0 ? functions.join(" -> ") : "从开局困境推进到阶段性回报。";
}

function buildPhaseArcs(chapters: ChapterChainItem[]): BookPhase[] {
  const groups = chunkChapters(chapters, Math.max(1, Math.ceil(chapters.length / 3)));
  return groups.map((group, index) => ({
    chapters: formatChapterRange(group),
    function: index === 0 ? "开局入局，建立核心压力和阅读承诺" : index === 1 ? "能力/关系推进，扩大冲突和期待" : "释放阶段回报，并抛出新的欠账",
    mainConflict: group.map((chapter) => chapter.conflict).filter(Boolean)[0] ?? "阶段冲突继续升级",
    readerEmotion: [...new Set(group.flatMap((chapter) => chapter.readerPulls.map(mapReaderPullToEmotion)))].slice(0, 4),
    payoff: group.flatMap((chapter) => chapter.highlights)[0] ?? "阶段性高光释放",
  }));
}

function buildReusableMaterials(
  chapterChain: ChapterChainItem[],
  characters: CharacterMaterial[],
  relationshipArcs: RelationshipArcMaterial[],
): ReusableMaterial[] {
  const materials: ReusableMaterial[] = [];
  for (const character of characters.slice(0, 4)) {
    materials.push({
      id: `character-${slugify(character.name)}`,
      kind: "character_archetype",
      label: `${character.roleGuess}：${character.name}`,
      pattern: `${character.pressure}下仍追求${character.desireGuess}的人物模型。`,
      tags: ["人物", character.roleGuess],
      sourceChapters: [character.firstSeenChapter],
      evidence: character.evidence,
      copyrightSafeNote: "保留人物功能和动机结构，不复用原文表达。",
    });
  }
  for (const arc of relationshipArcs) {
    materials.push({
      id: `relationship-${arc.characters.map(slugify).join("-")}`,
      kind: "relationship_dynamic",
      label: `${arc.characters.join(" / ")} 关系推进`,
      pattern: arc.usablePattern,
      tags: ["关系线", "张力", "信任变化"],
      sourceChapters: chapterChain.slice(0, 3).map((chapter) => chapter.chapterNumber),
      evidence: arc.turningPoints,
      copyrightSafeNote: "保留关系动力学，不复用具体桥段表达。",
    });
  }
  for (const chapter of chapterChain.slice(0, 12)) {
    materials.push({
      id: `chapter-hook-${chapter.chapterNumber}`,
      kind: "chapter_hook",
      label: `第 ${chapter.chapterNumber} 章钩子`,
      pattern: chapter.hookOut,
      tags: ["章节钩子", ...chapter.readerPulls.map(mapReaderPullToEmotion)],
      sourceChapters: [chapter.chapterNumber],
      evidence: [chapter.hookOut],
      copyrightSafeNote: "抽象章末欠账机制，使用时需重新生成场景和语言。",
    });
    materials.push({
      id: `highlight-${chapter.chapterNumber}`,
      kind: "highlight_pattern",
      label: `第 ${chapter.chapterNumber} 章高光`,
      pattern: chapter.reusablePattern,
      tags: ["高光", "情绪回报"],
      sourceChapters: [chapter.chapterNumber],
      evidence: chapter.highlights,
      copyrightSafeNote: "抽象高光功能，不直接迁移原文事件细节。",
    });
  }
  return materials;
}

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function countContentChars(text: string): number {
  return text.replace(/\s/g, "").length;
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?])\s*|\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function findSentence(text: string, signals: string[]): string | null {
  return splitSentences(text).find((sentence) => signals.some((signal) => sentence.includes(signal))) ?? null;
}

function findSentences(text: string, signals: string[], limit: number): string[] {
  return splitSentences(text)
    .filter((sentence) => signals.some((signal) => sentence.includes(signal)))
    .slice(0, limit);
}

function inferChapterFunction(chapterNumber: number, content: string): string {
  if (chapterNumber === 1) return "建立开局困境、核心人物压力和继续阅读期待";
  if (hasAny(content, HIGHLIGHT_SIGNALS)) return "释放阶段性高光，同时改变人物处境";
  if (hasAny(content, RELATIONSHIP_SIGNALS)) return "推进关系变化，让行动替代解释";
  if (hasAny(content, MYSTERY_SIGNALS)) return "抛出信息差或身世/阴谋欠账";
  return "承接上一章问题，并制造新的行动目标";
}

function inferConflict(content: string): string {
  if (hasAny(content, ["羞辱", "笑话", "退婚", "陷害"])) return "主角遭遇公开羞辱或身份压迫。";
  if (hasAny(content, ["病", "救", "药", "医"])) return "主角能力被危机逼出，需要在质疑中证明自己。";
  if (hasAny(content, ["暗中", "不肯", "误会"])) return "角色真实行动和表面态度之间存在信息差。";
  return "人物目标与外部阻碍发生碰撞。";
}

function inferRelationshipShift(content: string, names: string[]): string {
  if (names.length >= 2 && hasAny(content, ["暗中", "护", "拦下", "救"])) {
    return `${names.slice(0, 2).join("与")}从表面冲突转向隐性保护/重新评估。`;
  }
  if (names.length >= 2 && hasAny(content, ["正眼", "看出", "知道", "明白"])) {
    return `${names.slice(0, 2).join("与")}之间的信息差开始缩小。`;
  }
  if (names.length >= 2) return `${names.slice(0, 2).join("与")}被同一事件牵入新的关系张力。`;
  return "本章主要推进人物处境，关系变化较弱。";
}

function inferHighlight(content: string): string {
  if (hasAny(content, ["揭穿", "反击", "当场", "众人"])) return "公开场合中完成反击或身份/能力证明。";
  if (hasAny(content, ["救", "药", "医"])) return "用专业能力解决危机，形成能力高光。";
  if (hasAny(content, ["暗中", "护", "拦下"])) return "一方暗中相助，制造关系期待。";
  return "通过行动变化释放一个小回报。";
}

function inferReaderPulls(content: string, highlights: string[], conflict: string): string[] {
  const pulls = new Set<string>();
  if (hasAny(content, ["羞辱", "退婚", "笑话", "陷害"])) pulls.add("期待主角反击和打脸回报");
  if (hasAny(content, ["暗中", "不肯", "知道", "看出"])) pulls.add("期待信息差揭开");
  if (hasAny(content, ["玉佩", "身世", "幕后", "秘密"])) pulls.add("期待身世/阴谋真相");
  if (hasAny(content, ["正眼", "护", "救", "旧日"])) pulls.add("期待关系进一步变化");
  if (highlights.length > 0) pulls.add("期待下一次更大的情绪回报");
  if (pulls.size === 0 && conflict) pulls.add("期待当前冲突如何被解决");
  return [...pulls];
}

function inferReusablePattern(content: string): string {
  if (hasAny(content, ["羞辱", "退婚", "笑话"])) return "先制造憋屈和外部轻视，再安排主角用行动拿回主动权。";
  if (hasAny(content, ["暗中", "护", "拦下"])) return "让关系对象先用行动托底，再延迟揭示真实动机。";
  if (hasAny(content, ["揭穿", "假", "众人"])) return "公开场合反转权威判断，形成打脸高光。";
  if (hasAny(content, ["玉佩", "身世", "幕后"])) return "用物件或残缺线索把单章事件接到长线秘密。";
  return "用一个小目标承接上一章欠账，并在结尾制造新问题。";
}

function inferDesire(text: string): string {
  if (hasAny(text, ["救", "药", "医"])) return "证明自身能力并掌握命运";
  if (hasAny(text, ["退婚", "侯府", "羞辱"])) return "摆脱被定义的位置";
  if (hasAny(text, ["护", "暗中", "救命"])) return "弥补亏欠或保护重要之人";
  return "在压力中争取主动权";
}

function inferPressure(text: string): string {
  if (hasAny(text, ["退婚", "羞辱", "笑话"])) return "公开羞辱";
  if (hasAny(text, ["侯府", "众人"])) return "家族/阶层压迫";
  if (hasAny(text, ["暗中", "不肯", "避开"])) return "隐瞒和信息差";
  return "外部评价和目标阻碍";
}

function extractCharacterNames(chapters: ParsedChapter[]): string[] {
  const counts = new Map<string, number>();
  const firstSeenOrder = new Map<string, number>();
  let candidateOrder = 0;
  const blocked = new Set(["第一章", "第二章", "第三章", "侯府", "众人", "掌柜", "门外", "幕后", "旧日", "时候", "殿下", "什么", "公子", "娘娘", "陛下", "自己", "自己的", "如此", "今日", "一声", "方才", "只不过", "白自己", "于明白", "明白", "白了", "起来", "出来", "知道", "大人", "何事", "梅鹤"]);
  for (const chapter of chapters) {
    const matches = [
      ...(chapter.content.match(/[\u4e00-\u9fa5]{2,3}/g) ?? []),
      ...(chapter.content.match(/[赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹崔陆白][\u4e00-\u9fa5]{1,2}/g) ?? []),
    ].map(normalizeNameCandidate);
    for (const match of matches) {
      if (match.length < 2) continue;
      if (blocked.has(match)) continue;
      if (COMMON_WORDS.has(match)) continue;
      if (/^[一二三四五六七八九十百千万两个人]+$/.test(match)) continue;
      counts.set(match, (counts.get(match) ?? 0) + 1);
      if (!firstSeenOrder.has(match)) firstSeenOrder.set(match, candidateOrder);
      candidateOrder += 1;
    }
  }

  return [...counts.entries()]
    .filter(([name, count]) => isLikelyPersonCandidate(name, count))
    .sort((a, b) => b[1] - a[1] || (firstSeenOrder.get(a[0]) ?? 0) - (firstSeenOrder.get(b[0]) ?? 0))
    .map(([name]) => name)
    .slice(0, 80);
}

function isLikelyPersonCandidate(name: string, count: number): boolean {
  if (TITLE_ALIASES.has(name) || COMMON_WORDS.has(name)) return false;
  if (isLikelyPersonName(name)) return true;
  if (/(?:太医|嬷嬷|阁老|大人)$/.test(name) && count >= 2) return true;
  if (name.length === 2 && count >= 20 && !hasAny(name, ["的", "了", "是", "不", "在", "有", "一", "人", "声", "眼", "手", "门", "心", "话", "事", "影", "眉"])) return true;
  return false;
}

function isLikelyPersonName(name: string): boolean {
  return /^[赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹崔陆白林谢宣][\u4e00-\u9fa5]{1,2}$/.test(name);
}

function normalizeNameCandidate(candidate: string): string {
  let value = candidate.trim().replace(/^[和与及同]/u, "");
  while (value.length > 2 && /[说问道看听站避把将被在从向给替却终当暗送发带入借质记守改提]/u.test(value[value.length - 1])) {
    value = value.slice(0, -1);
  }
  return value;
}

function chunkChapters<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

function formatChapterRange(group: ChapterChainItem[]): string {
  const first = group[0]?.chapterNumber ?? 1;
  const last = group[group.length - 1]?.chapterNumber ?? first;
  return first === last ? `第 ${first} 章` : `第 ${first}-${last} 章`;
}

function mapReaderPullToEmotion(pull: string): string {
  if (pull.includes("反击") || pull.includes("打脸")) return "爽感";
  if (pull.includes("信息差") || pull.includes("真相")) return "好奇";
  if (pull.includes("关系")) return "暧昧/期待";
  if (pull.includes("回报")) return "奖励感";
  return "期待";
}

function hasAny(text: string, signals: string[]): boolean {
  return signals.some((signal) => text.includes(signal));
}

function slugify(text: string): string {
  return encodeURIComponent(text).replace(/%/g, "").slice(0, 32).toLowerCase() || "item";
}

const CONFLICT_SIGNALS = ["退婚", "羞辱", "陷害", "危机", "病", "不肯", "侯府", "反击", "揭穿"];
const HIGHLIGHT_SIGNALS = ["救下", "改口", "当场", "揭穿", "反击", "正眼", "护", "拦下", "众人哗然"];
const RELATIONSHIP_SIGNALS = ["暗中", "护", "避开", "旧日", "正眼", "知道", "看出"];
const MYSTERY_SIGNALS = ["身世", "幕后", "秘密", "玉佩", "线索"];
const TITLE_ALIASES = new Set(["长公主", "大长公主", "大长公", "殿下", "公主", "公主殿"]);
const COMMON_WORDS = new Set([
  "站在", "门前", "听见", "二字", "没有", "只问", "一句", "当真", "如此", "避开", "目光",
  "心里", "记着", "救命", "之恩", "等着", "笑话", "婚书", "放回", "桌上", "药铺", "病重",
  "孩子", "当场", "改口", "先生", "替她", "拦下", "的人", "这件", "事里", "背后", "自己",
  "设宴", "一张", "药方", "假神", "终于", "半枚", "像是", "有关",
]);
