import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import {
  decomposeNovelText,
  formatMaterialReviewMarkdown,
  saveMaterialDecomposition,
} from "../src/materials/decomposer.js";

const ROOT = path.resolve("materials/_test_runs");

const SAMPLE_TEXT = [
  "第一章 退婚",
  "沈清辞站在侯府门前，听见萧衍说退婚二字。",
  "她没有哭，只问了一句：你当真要如此？",
  "萧衍避开她的目光，心里却记着旧日救命之恩。",
  "门外众人等着看她笑话，她把婚书放回桌上。",
  "",
  "第二章 医术",
  "沈清辞在药铺救下病重的孩子，掌柜当场改口称她先生。",
  "萧衍暗中替她拦下侯府的人，却不肯让她知道。",
  "她从这件事里看出有人在背后护着自己。",
  "",
  "第三章 反击",
  "侯府设宴羞辱沈清辞，她用一张药方揭穿假神医。",
  "众人哗然，萧衍终于正眼看她。",
  "幕后之人留下半枚玉佩，像是和她身世有关。",
].join("\n");

beforeEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
});

afterEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
});

describe("materials decomposer", () => {
  it("decomposes a novel text into reviewable structural materials", () => {
    const result = decomposeNovelText({
      sourceId: "sample-romance",
      title: "退婚医女",
      text: SAMPLE_TEXT,
    });

    expect(result.source.id).toBe("sample-romance");
    expect(result.bookStructure.corePromise).toContain("沈清辞");
    expect(result.chapterChain).toHaveLength(3);
    expect(result.chapterChain[0]).toMatchObject({
      chapterNumber: 1,
      title: "退婚",
    });
    expect(result.chapterChain[0].readerPulls.length).toBeGreaterThan(0);
    expect(result.relationshipArcs[0].characters).toContain("沈清辞");
    expect(result.reusableMaterials.some((item) => item.kind === "chapter_hook")).toBe(true);
    expect(result.reviewChecklist).toContain("检查 chapterChain 是否覆盖主要章节功能。");
  });

  it("formats a markdown review with chapter chain and reusable materials", () => {
    const result = decomposeNovelText({
      sourceId: "sample-romance",
      title: "退婚医女",
      text: SAMPLE_TEXT,
    });

    const markdown = formatMaterialReviewMarkdown(result);

    expect(markdown).toContain("# 退婚医女 素材拆解 Review");
    expect(markdown).toContain("## 整书结构");
    expect(markdown).toContain("## 章节链路");
    expect(markdown).toContain("第 1 章：退婚");
    expect(markdown).toContain("## 可复用素材");
  });

  it("splits numbered web-novel chapter headings", () => {
    const result = decomposeNovelText({
      sourceId: "numbered-romance",
      title: "数字章节样例",
      text: [
        "1.  觉   这七年，原是她一厢情愿。",
        "长公主望着旧人，没有再回头。",
        "梅鹤庭终于明白自己错过了什么。",
        "",
        "2.  悟   梅鹤庭，我不要你了",
        "殿下把旧物还给他，满堂无人敢言。",
      ].join("\n"),
    });

    expect(result.source.chapterCount).toBe(2);
    expect(result.chapterChain[0].title).toContain("觉");
    expect(result.chapterChain[1].title).toContain("悟");
  });

  it("merges titles courtesy names and honorifics into canonical characters", () => {
    const result = decomposeNovelText({
      sourceId: "alias-romance",
      title: "别名样例",
      text: [
        "第一章 觉",
        "宣明珠醒来，长公主府灯火通明。",
        "殿下没有回头，大长公主只把旧信放下。",
        "梅鹤庭站在门外，旁人都称梅大人。",
        "长生，是梅鹤庭的小字。梅长生终于明白自己错了。",
        "",
        "第二章 悟",
        "长公主要休驸马，宣明珠再不肯等。",
        "梅大人低声道歉，梅长生却已经迟了。",
        "梅阁老也在门外，梅阁老没有替他说话。",
      ].join("\n"),
    });

    const names = result.characters.map((character) => character.name);
    expect(names).toContain("宣明珠");
    expect(names).toContain("梅鹤庭");
    expect(names).not.toContain("长公主");
    expect(names).not.toContain("大长公主");
    expect(names).not.toContain("殿下");
    expect(names).not.toContain("梅长生");
    expect(names).not.toContain("梅大人");

    const princess = result.characters.find((character) => character.name === "宣明珠");
    const mei = result.characters.find((character) => character.name === "梅鹤庭");
    expect(princess?.aliases).toEqual(expect.arrayContaining(["长公主", "大长公主", "殿下"]));
    expect(mei?.aliases).toEqual(expect.arrayContaining(["梅长生", "梅大人"]));
    const elderMei = result.characters.find((character) => character.name === "梅阁老");
    expect(elderMei?.aliases).not.toContain("梅大人");

    const markdown = formatMaterialReviewMarkdown(result);
    expect(markdown).toContain("- 宣明珠（核心主角）");
    expect(markdown).toContain("长公主");
    expect(markdown).toContain("别名：长生、梅长生、梅大人");
  });

  it("keeps a larger cast and extracts main plus mini plot threads", () => {
    const text = [
      "第一章 入局",
      "沈清辞遇见萧衍，顾明月带着周太医查案。",
      "秦若兰质疑沈清辞，林嬷嬷替她传话。",
      "赵景安发现半枚玉佩，苏锦屏记下线索。",
      "韩知节和陆青禾守在门外，白芷送来药箱。",
      "谢云舟暗中盯着侯府，崔锦衣奉命追查。",
      "",
      "第二章 药铺小案",
      "沈清辞在药铺救人，萧衍暗中拦下侯府追兵。",
      "顾明月询问周太医，秦若兰再次挑衅。",
      "林嬷嬷、赵景安、苏锦屏都被卷入药铺小案。",
      "",
      "第三章 宫宴支线",
      "韩知节带陆青禾入宫，白芷发现药方被换。",
      "谢云舟提醒崔锦衣，幕后之人可能在宫宴上动手。",
      "沈清辞和萧衍借宫宴反击，顾明月终于改变态度。",
    ].join("\n");

    const result = decomposeNovelText({
      sourceId: "large-cast",
      title: "群像样例",
      text,
    });

    const names = result.characters.map((character) => character.name);
    expect(result.characters.length).toBeGreaterThan(8);
    expect(names).toEqual(expect.arrayContaining(["沈清辞", "萧衍", "顾明月", "周太医", "秦若兰", "崔锦衣"]));
    expect(result.characters[0]).toMatchObject({ importance: "lead" });
    expect(result.characters[0].mentionCount).toBeGreaterThan(0);
    expect(result.characters[0].appearanceChapters.length).toBeGreaterThan(0);
    expect(result.plotThreads.some((thread) => thread.kind === "main")).toBe(true);
    const medicineArc = result.plotThreads.find((thread) => thread.kind === "mini_arc" && thread.title.includes("药铺"));
    const banquetArc = result.plotThreads.find((thread) => thread.kind === "mini_arc" && thread.title.includes("宫宴"));
    expect(medicineArc).toBeTruthy();
    expect(banquetArc).toBeTruthy();
    expect(medicineArc?.summary).toContain("沈清辞");
    expect(medicineArc?.summary).toContain("药铺");
    expect(medicineArc?.background).toContain("第 2 章");
    expect(medicineArc?.keyEvents.length).toBeGreaterThan(0);
    expect(medicineArc?.outcome).toContain("萧衍");
  });

  it("saves json and markdown artifacts for review", async () => {
    const result = decomposeNovelText({
      sourceId: "sample-romance",
      title: "退婚医女",
      text: SAMPLE_TEXT,
    });

    const saved = await saveMaterialDecomposition(result, { rootDir: ROOT });

    expect(saved.jsonPath).toBe(path.join(ROOT, "sample-romance", "decomposition.json"));
    expect(saved.reviewPath).toBe(path.join(ROOT, "sample-romance", "review.md"));
    expect(saved.splitDir).toBe(path.join(ROOT, "sample-romance", "split"));
    await expect(fs.stat(saved.jsonPath)).resolves.toBeTruthy();
    await expect(fs.stat(saved.reviewPath)).resolves.toBeTruthy();
    await expect(fs.stat(saved.splitPaths.characters)).resolves.toBeTruthy();
    await expect(fs.stat(saved.splitPaths.relationships)).resolves.toBeTruthy();
    await expect(fs.stat(saved.splitPaths.plotThreads)).resolves.toBeTruthy();
    await expect(fs.stat(saved.splitPaths.chapterChain)).resolves.toBeTruthy();
    await expect(fs.stat(path.join(saved.splitPaths.reusableByKindDir, "chapter_hook.json"))).resolves.toBeTruthy();

    const savedJson = JSON.parse(await fs.readFile(saved.jsonPath, "utf-8"));
    const savedMarkdown = await fs.readFile(saved.reviewPath, "utf-8");
    const characters = JSON.parse(await fs.readFile(saved.splitPaths.characters, "utf-8"));
    const relationships = JSON.parse(await fs.readFile(saved.splitPaths.relationships, "utf-8"));
    const chapterHooks = JSON.parse(await fs.readFile(path.join(saved.splitPaths.reusableByKindDir, "chapter_hook.json"), "utf-8"));
    expect(savedJson.chapterChain).toHaveLength(3);
    expect(savedMarkdown).toContain("素材拆解 Review");
    expect(characters.items.map((item: { name: string }) => item.name)).toContain("沈清辞");
    expect(relationships.items[0].characters).toContain("沈清辞");
    expect(chapterHooks.items.every((item: { kind: string }) => item.kind === "chapter_hook")).toBe(true);
  });
});
