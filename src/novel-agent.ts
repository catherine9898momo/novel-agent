/**
 * novel-agent.ts - 主入口
 *
 * 流程：
 *   1. 选择小说（CLI 参数 或 交互菜单）
 *   2. 检测小说状态（空白 / 仅章节 / 仅规划 / 部分完成 / 已完结）
 *   3. 规划阶段：逐项生成缺失的规划文件，每项 HITL 确认
 *   4. 写作阶段：每章独立 subagent，注入故事摘要 + 上章结尾
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs/promises";
import path from "path";
import * as readline from "readline";
import * as dotenv from "dotenv";
import { agentLoop, type Message, type CompactOptions } from "./agent-loop.js";
import { TOOLS_DEFINITION, makeToolHandlers } from "./tools.js";
import { TodoList } from "./todo.js";
import { autoCompress } from "./context-compact.js";

dotenv.config();

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: process.env.ANTHROPIC_BASE_URL,
  defaultHeaders: {
    "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
    "Authorization": `Bearer ${process.env.ANTHROPIC_API_KEY}`,
  },
});
const MODEL = process.env.MODEL_ID ?? "claude-sonnet-4-20250514";
const NOVELS_DIR = path.resolve("novels");

const compactOptions: CompactOptions = {
  enableMicro: true,
  keepLast: 3,
  threshold: 80_000,
};

// ── 工具函数 ──────────────────────────────────────────────────

async function loadStyle(styleName: string): Promise<string> {
  const p = path.resolve("skills", "styles", `${styleName}.md`);
  return await fs.readFile(p, "utf-8").catch(() => "");
}

export interface ChapterMeta {
  title: string;
  target_words?: number;
  mood?: string;
  required_scenes?: string[];
  plot_hooks?: string[];
}

async function loadChapters(novelDir: string): Promise<ChapterMeta[] | null> {
  const raw = await fs.readFile(path.join(novelDir, "_chapters.json"), "utf-8").catch(() => null);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as (string | ChapterMeta)[];
  return parsed.map((c) => (typeof c === "string" ? { title: c } : c));
}

function askLine(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ── 小说选择 ──────────────────────────────────────────────────

async function selectNovel(): Promise<string> {
  const arg = process.argv[2];
  if (arg) return arg;

  await fs.mkdir(NOVELS_DIR, { recursive: true });
  const entries = await fs.readdir(NOVELS_DIR, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  if (dirs.length === 0) {
    const name = await askLine("novels/ 目录为空，请输入新小说标题：");
    return name;
  }

  console.log("\n── 选择小说 ──────────────────────────────");
  dirs.forEach((d, i) => console.log(`  ${i + 1}. ${d}`));
  console.log(`  ${dirs.length + 1}. 新建小说`);

  const input = await askLine("\n请输入序号：");
  const idx = parseInt(input, 10) - 1;

  if (idx === dirs.length) {
    return await askLine("请输入新小说标题：");
  }
  if (idx >= 0 && idx < dirs.length) return dirs[idx];

  console.log("无效输入，退出。");
  process.exit(1);
}

// ── 状态检测 ──────────────────────────────────────────────────

interface NovelState {
  hasOutline: boolean;
  hasCharacters: boolean;
  hasRelationships: boolean;
  hasChapters: boolean;
  hasStorySoFar: boolean;
  chaptersHaveMetadata: boolean;
  existingChapterNums: number[];
}

async function detectState(novelDir: string): Promise<NovelState> {
  const files = await fs.readdir(novelDir).catch((): string[] => []);
  const existingChapterNums = files
    .filter((f) => /^\d{3}-/.test(f) && f.endsWith(".md"))
    .map((f) => parseInt(f.slice(0, 3), 10));

  // 检查 _chapters.json 是否已有元数据（非纯字符串数组）
  let chaptersHaveMetadata = false;
  if (files.includes("_chapters.json")) {
    const raw = await fs.readFile(path.join(novelDir, "_chapters.json"), "utf-8").catch(() => "[]");
    const parsed = JSON.parse(raw) as (string | ChapterMeta)[];
    chaptersHaveMetadata = parsed.length > 0 && typeof parsed[0] === "object";
  }

  return {
    hasOutline: files.includes("_outline.md"),
    hasCharacters: files.includes("_characters.md"),
    hasRelationships: files.includes("_relationships.md"),
    hasChapters: files.includes("_chapters.json"),
    hasStorySoFar: files.includes("_story_so_far.md"),
    chaptersHaveMetadata,
    existingChapterNums,
  };
}

// ── HITL 确认 ─────────────────────────────────────────────────

async function hitlGate(
  label: string,
  getContent: () => Promise<string>,
  regenerate: (feedback: string) => Promise<void>,
): Promise<void> {
  while (true) {
    const content = await getContent();
    console.log(`\n── [${label}] 已生成 ${"─".repeat(Math.max(0, 40 - label.length))}`);
    console.log(content);
    console.log("─".repeat(50));
    const answer = await askLine(`确认 ${label}？(y / 输入修改意见重新生成) `);
    if (answer.toLowerCase() === "y") return;
    console.log(`\n[${label}] 根据反馈重新生成...`);
    await regenerate(answer);
  }
}

// ── 规划 agent 工厂 ───────────────────────────────────────────

async function runPlanAgent(
  novelTitle: string,
  novelDir: string,
  styleGuide: string,
  type: "outline" | "characters" | "relationships",
  existingContext: string,
  feedback?: string,
): Promise<void> {
  const onTool = (toolName: string, output: string) =>
    console.log(`  [工具] ${toolName}: ${String(output).slice(0, 80)}`);

  const handlers = makeToolHandlers(novelTitle);

  const feedbackSection = feedback
    ? `\n## 用户反馈（请根据此反馈修改）\n${feedback}\n`
    : "";

  const typeLabel: Record<string, string> = {
    outline: "故事大纲",
    characters: "人物设定",
    relationships: "人物关系",
  };

  const typeInstructions: Record<string, string> = {
    outline: "包含：一句话核心冲突、三幕结构、各章节目标、主要情节转折点",
    characters: "每个主要角色：姓名、身份、外貌、性格、核心动机、成长弧",
    relationships: "主要角色之间的关系、矛盾点、情感走向、权力结构",
  };

  // 前序规划文件注入：characters 依赖 outline，relationships 依赖 outline + characters
  const priorPlanTypes: Record<string, ("outline" | "characters")[]> = {
    outline: [],
    characters: ["outline"],
    relationships: ["outline", "characters"],
  };
  const priorSections: string[] = [];
  for (const dep of priorPlanTypes[type]) {
    const content = await fs.readFile(path.join(novelDir, `_${dep}.md`), "utf-8").catch(() => null);
    if (content) priorSections.push(`## 已有${typeLabel[dep]}\n${content}`);
  }
  const priorContext = priorSections.length > 0 ? "\n" + priorSections.join("\n\n") + "\n" : "";

  const system = `你是一位资深古言言情小说策划，正在为《${novelTitle}》生成${typeLabel[type]}。

## 写作风格参考
${styleGuide}
${existingContext}${priorContext}${feedbackSection}
## 任务
生成${typeLabel[type]}，要求：${typeInstructions[type]}。必须与已有规划保持一致。
完成后调用 write_plan(type="${type}") 保存，然后回复"完成"。`;

  const messages: Message[] = [
    { role: "user", content: `请为《${novelTitle}》生成${typeLabel[type]}，完成后保存。` },
  ];

  await agentLoop(client, MODEL, system, messages, TOOLS_DEFINITION, handlers, onTool, compactOptions);
}

async function runChapterProposalAgent(
  novelTitle: string,
  novelDir: string,
  styleGuide: string,
  existingContext: string,
  feedback?: string,
): Promise<ChapterMeta[]> {
  const onTool = (toolName: string, output: string) =>
    console.log(`  [工具] ${toolName}: ${String(output).slice(0, 80)}`);

  let proposedTitles: string[] = [];
  const handlers = makeToolHandlers(novelTitle, undefined, undefined, undefined, (ch) => { proposedTitles = ch; });

  const feedbackSection = feedback ? `\n## 用户反馈\n${feedback}\n` : "";

  const system = `你是一位资深古言言情小说策划，正在为《${novelTitle}》规划章节列表。

## 写作风格参考
${styleGuide}
${existingContext}${feedbackSection}
## 任务
先用 read_plan 读取 outline、characters、relationships，然后调用 propose_chapters 提交章节列表。
- 每章使用对象格式，包含：title（标题）、target_words（目标字数）、mood（情绪基调）、required_scenes（必须出现的场景）、plot_hooks（需要埋下的伏笔）
- 章节数量根据故事体量自主决定（建议 5-15 章）
- 如果已有章节文件，续写章节编号从已有章节之后开始
完成后回复"完成"。`;

  const messages: Message[] = [
    { role: "user", content: `请为《${novelTitle}》规划章节列表。` },
  ];

  await agentLoop(client, MODEL, system, messages, TOOLS_DEFINITION, handlers, onTool, compactOptions);
  // 从文件读取完整元数据（proposedTitles 只有标题，完整数据在文件里）
  return (await loadChapters(novelDir)) ?? proposedTitles.map((t) => ({ title: t }));
}

// ── 逆向提取：读取已有章节内容 ────────────────────────────────

async function loadExistingChaptersText(novelDir: string, nums: number[]): Promise<string> {
  if (nums.length === 0) return "";
  const files = await fs.readdir(novelDir).catch((): string[] => []);
  const parts: string[] = [];
  for (const num of nums.slice(0, 5)) { // 最多读前5章避免 token 过多
    const prefix = String(num).padStart(3, "0");
    const file = files.find((f) => f.startsWith(prefix));
    if (file) {
      const content = await fs.readFile(path.join(novelDir, file), "utf-8").catch(() => "");
      parts.push(`### ${file}\n${content.slice(0, 1500)}`);
    }
  }
  if (parts.length === 0) return "";
  return `\n## 已有章节内容（请基于此提取/推断设定，不要凭空创作）\n${parts.join("\n\n")}\n`;
}

// ── 全文分析 agent ────────────────────────────────────────────

async function runAnalysisAgent(
  novelTitle: string,
  novelDir: string,
  styleGuide: string,
  state: NovelState,
): Promise<void> {
  console.log("\n── 全文分析：重建故事状态 ────────────────────────────");

  // 读取所有已写章节（全文，不截断）
  const files = await fs.readdir(novelDir).catch((): string[] => []);
  const chapterFiles = files
    .filter((f) => /^\d{3}-/.test(f) && f.endsWith(".md"))
    .sort();

  if (chapterFiles.length === 0) {
    console.log("[分析] 无已写章节，跳过全文分析");
    return;
  }

  const chapterTexts: string[] = [];
  for (const file of chapterFiles) {
    const content = await fs.readFile(path.join(novelDir, file), "utf-8").catch(() => "");
    chapterTexts.push(`### ${file}\n${content}`);
  }
  const allChaptersText = chapterTexts.join("\n\n---\n\n");

  // 读取现有规划文件
  const outline = await fs.readFile(path.join(novelDir, "_outline.md"), "utf-8").catch(() => "");
  const characters = await fs.readFile(path.join(novelDir, "_characters.md"), "utf-8").catch(() => "");
  const relationships = await fs.readFile(path.join(novelDir, "_relationships.md"), "utf-8").catch(() => "");
  const chaptersRaw = await fs.readFile(path.join(novelDir, "_chapters.json"), "utf-8").catch(() => "[]");
  const existingChapters = (JSON.parse(chaptersRaw) as (string | ChapterMeta)[]).map(
    (c) => (typeof c === "string" ? { title: c } : c)
  );

  // 识别章节空洞
  const writtenNums = state.existingChapterNums.slice().sort((a, b) => a - b);
  const totalChapters = existingChapters.length;
  const missingNums = Array.from({ length: totalChapters }, (_, i) => i + 1).filter(
    (n) => !writtenNums.includes(n)
  );

  console.log(`[分析] 已写章节：${writtenNums.join(", ")}`);
  if (missingNums.length > 0) {
    console.log(`[分析] 缺失章节：${missingNums.join(", ")}`);
  }

  // ── LLM 分析：一次调用，结构化输出 ──
  console.log("[分析] 正在分析全文，生成故事状态...");

  const needsStorySoFar = !state.hasStorySoFar;
  const needsMetadata = !state.chaptersHaveMetadata;

  const tasks: string[] = [];
  if (needsStorySoFar) tasks.push("1. 故事摘要（_story_so_far.md）：截至最后一章的故事摘要，800字以内，包含：主要事件、人物当前状态、未解决的冲突");
  if (needsMetadata) tasks.push("2. 章节元数据补全：为所有章节（包括未写章节）生成完整的 ChapterMeta 对象，包含 target_words、mood、required_scenes、plot_hooks");
  tasks.push("3. 伏笔清单（_foreshadowing.json）：识别已埋但未回收的伏笔，格式：[{desc, planted_at, status, expected_resolution}]");
  tasks.push("4. 断点分析：最后一章写到哪里，下一章应接什么，当前处于三幕结构哪个位置");

  const analysisPrompt = `你是一位资深小说编辑，正在分析《${novelTitle}》的已有内容，重建故事状态。

## 写作风格参考
${styleGuide}

## 故事大纲
${outline}

## 人物设定
${characters}

## 人物关系
${relationships}

## 已写章节全文
${allChaptersText}

## 当前章节列表
${JSON.stringify(existingChapters, null, 2)}

## 分析任务
${tasks.join("\n")}

## 输出要求
请严格按以下 JSON 格式输出，不要有任何额外文字：
{
  "story_so_far": "故事摘要文本（800字以内）",
  "chapters_with_metadata": [
    {
      "title": "章节标题",
      "target_words": 1500,
      "mood": "情绪基调",
      "required_scenes": ["场景1", "场景2"],
      "plot_hooks": ["伏笔1", "伏笔2"]
    }
  ],
  "foreshadowing": [
    {
      "desc": "伏笔描述",
      "planted_at": "第X章",
      "status": "已埋/推进中/已回收",
      "expected_resolution": "预期回收位置"
    }
  ],
  "breakpoint_analysis": "断点分析文本"
}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    messages: [{ role: "user", content: analysisPrompt }],
  });

  const rawText = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");

  // 提取 JSON（兼容 markdown 代码块）
  const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) ?? rawText.match(/(\{[\s\S]*\})/);
  if (!jsonMatch) {
    console.error("[分析] 无法解析分析结果，跳过");
    return;
  }

  let analysisResult: {
    story_so_far: string;
    chapters_with_metadata: ChapterMeta[];
    foreshadowing: Array<{ desc: string; planted_at: string; status: string; expected_resolution: string }>;
    breakpoint_analysis: string;
  };

  try {
    analysisResult = JSON.parse(jsonMatch[1]);
  } catch {
    console.error("[分析] JSON 解析失败，跳过");
    return;
  }

  // ── 展示分析结果，HITL 确认 ──
  console.log("\n── [全文分析结果] ────────────────────────────────────");
  if (needsStorySoFar) {
    console.log("\n【故事摘要】");
    console.log(analysisResult.story_so_far);
  }
  console.log("\n【断点分析】");
  console.log(analysisResult.breakpoint_analysis);
  console.log("\n【识别到的伏笔】");
  analysisResult.foreshadowing.forEach((f, i) => {
    console.log(`  ${i + 1}. [${f.status}] ${f.desc}（${f.planted_at} → ${f.expected_resolution}）`);
  });
  if (needsMetadata) {
    console.log("\n【待写章节元数据预览】");
    analysisResult.chapters_with_metadata
      .filter((c) => {
        const idx = existingChapters.findIndex((e) => e.title === c.title);
        return idx >= 0 && !writtenNums.includes(idx + 1);
      })
      .forEach((c) => {
        console.log(`  ${c.title} | ${c.mood} | ${c.target_words}字`);
      });
  }
  console.log("─".repeat(50));

  const confirm = await askLine("\n确认分析结果并写入文件？(y / n) ");
  if (confirm.toLowerCase() !== "y") {
    console.log("[分析] 已跳过，继续使用现有文件");
    return;
  }

  // ── 写入文件 ──
  if (needsStorySoFar && analysisResult.story_so_far) {
    await fs.writeFile(path.join(novelDir, "_story_so_far.md"), analysisResult.story_so_far, "utf-8");
    console.log("[分析] 已写入 _story_so_far.md");
  }

  if (needsMetadata && analysisResult.chapters_with_metadata?.length > 0) {
    await fs.writeFile(
      path.join(novelDir, "_chapters.json"),
      JSON.stringify(analysisResult.chapters_with_metadata, null, 2),
      "utf-8"
    );
    console.log("[分析] 已更新 _chapters.json（含元数据）");
  }

  if (analysisResult.foreshadowing?.length > 0) {
    await fs.writeFile(
      path.join(novelDir, "_foreshadowing.json"),
      JSON.stringify(analysisResult.foreshadowing, null, 2),
      "utf-8"
    );
    console.log("[分析] 已写入 _foreshadowing.json");
  }

  // ── 缺失章节处理 ──
  if (missingNums.length > 0) {
    console.log(`\n── 检测到缺失章节：第 ${missingNums.join("、")} 章 ──`);
    console.log("  1. 补写缺失章节（按大纲正向写）");
    console.log("  2. 跳过，直接从当前断点续写");
    console.log("  3. 将缺失章节标记为番外，不影响主线");
    const choice = await askLine("请选择处理方式 (1/2/3)：");

    if (choice === "1") {
      // 将缺失章节的 todo 状态保持 pending，写作阶段会自动处理
      console.log("[分析] 缺失章节将在写作阶段按顺序补写");
    } else if (choice === "2") {
      // 把缺失章节在 todo 里标为 done（跳过）
      // 这里只记录用户意图，todo 在 main() 里初始化，传递信号通过文件
      await fs.writeFile(
        path.join(novelDir, "_skip_chapters.json"),
        JSON.stringify(missingNums),
        "utf-8"
      );
      console.log("[分析] 缺失章节将被跳过");
    } else if (choice === "3") {
      await fs.writeFile(
        path.join(novelDir, "_skip_chapters.json"),
        JSON.stringify(missingNums),
        "utf-8"
      );
      console.log("[分析] 缺失章节已标记为番外，跳过主线写作");
    }
  }

  console.log("\n[分析] 全文分析完成，进入写作阶段");
}

// ── 主流程 ────────────────────────────────────────────────────

async function main() {
  const novelTitle = await selectNovel();
  const style = "ancient-romance";
  const styleGuide = await loadStyle(style);
  const novelDir = path.join(NOVELS_DIR, novelTitle);
  const todoFilepath = path.join(novelDir, "_todo.json");

  await fs.mkdir(novelDir, { recursive: true });

  const onTool = (toolName: string, output: string) =>
    console.log(`[工具] ${toolName}: ${String(output).slice(0, 80)}`);

  console.log(`\n── 《${novelTitle}》──────────────────────────────`);

  const state = await detectState(novelDir);
  const hasAnyChapters = state.existingChapterNums.length > 0;
  const existingContext = await loadExistingChaptersText(novelDir, state.existingChapterNums);

  // ── 孤立草稿清理 ──────────────────────────────────────────
  {
    const allFiles = await fs.readdir(novelDir).catch((): string[] => []);
    const drafts = allFiles.filter((f) => f.endsWith(".draft.md"));
    for (const draft of drafts) {
      const finalName = draft.replace(".draft.md", ".md");
      if (allFiles.includes(finalName)) {
        await fs.unlink(path.join(novelDir, draft)).catch(() => null);
        console.log(`[清理] 删除孤立草稿：${draft}`);
      }
    }
  }

  // ── 阶段一：规划 ──────────────────────────────────────────
  console.log("\n── 阶段一：规划 ──────────────────────────────────");

  const missingPlan = [
    !state.hasOutline && "outline" as const,
    !state.hasCharacters && "characters" as const,
    !state.hasRelationships && "relationships" as const,
  ].filter(Boolean) as ("outline" | "characters" | "relationships")[];

  if (missingPlan.length > 0) {
    if (hasAnyChapters) {
      console.log(`[检测] 发现 ${state.existingChapterNums.length} 个已有章节，将基于已有内容逆向提取规划`);
    }

    for (const type of missingPlan) {
      console.log(`\n[规划] 生成 ${type}...`);
      await runPlanAgent(novelTitle, novelDir, styleGuide, type, existingContext);

      await hitlGate(
        type,
        () => fs.readFile(path.join(novelDir, `_${type}.md`), "utf-8"),
        (feedback) => runPlanAgent(novelTitle, novelDir, styleGuide, type, existingContext, feedback),
      );
    }
  } else {
    console.log("[规划] outline / characters / relationships 均已存在，跳过");
  }

  // ── 章节列表 ──────────────────────────────────────────────
  let proposedChapters: ChapterMeta[] = [];

  if (!state.hasChapters) {
    console.log("\n[规划] 生成章节列表...");
    proposedChapters = await runChapterProposalAgent(novelTitle, novelDir, styleGuide, existingContext);

    await hitlGate(
      "章节列表",
      async () => {
        const ch = await loadChapters(novelDir);
        return ch ? ch.map((c, i) => `${i + 1}. ${c.title}`).join("\n") : "（未生成）";
      },
      async (feedback) => {
        proposedChapters = await runChapterProposalAgent(novelTitle, novelDir, styleGuide, existingContext, feedback);
      },
    );
  } else {
    console.log("[规划] _chapters.json 已存在，跳过");
    proposedChapters = (await loadChapters(novelDir)) ?? [];
  }

  const chapters: ChapterMeta[] = proposedChapters.length > 0
    ? proposedChapters
    : (await loadChapters(novelDir)) ?? [];

  if (chapters.length === 0) {
    console.error("[错误] 无法获取章节列表");
    return;
  }

  // ── 全文分析（有已写章节但缺少故事摘要或章节元数据时触发）──
  const stateAfterPlan = await detectState(novelDir);
  const hasWrittenChapters = stateAfterPlan.existingChapterNums.length > 0;
  const needsAnalysis = hasWrittenChapters && (!stateAfterPlan.hasStorySoFar || !stateAfterPlan.chaptersHaveMetadata);

  if (needsAnalysis) {
    await runAnalysisAgent(novelTitle, novelDir, styleGuide, stateAfterPlan);
  }

  // 分析后重新加载章节（元数据可能已更新）
  const finalChapters = (await loadChapters(novelDir)) ?? chapters;

  // ── 恢复 todo ─────────────────────────────────────────────
  const chapterTitles = finalChapters.map((c) => c.title);
  let todo = await TodoList.load(todoFilepath);
  // 读取需要跳过的章节（由全文分析阶段写入）
  const skipChaptersRaw = await fs.readFile(path.join(novelDir, "_skip_chapters.json"), "utf-8").catch(() => "[]");
  const skipNums: number[] = JSON.parse(skipChaptersRaw);

  if (todo) {
    todo.addIfAbsent(chapterTitles);
    console.log("\n[续写] 从 _todo.json 恢复任务状态");
  } else {
    todo = new TodoList();
    todo.add(chapterTitles);
    for (const item of todo.pending()) {
      if (stateAfterPlan.existingChapterNums.includes(item.id)) todo.update(item.id, "done");
    }
    await todo.save(todoFilepath);
  }

  // 跳过用户选择不写的章节
  if (skipNums.length > 0) {
    for (const item of todo.pending()) {
      if (skipNums.includes(item.id)) {
        todo.update(item.id, "done");
        console.log(`[跳过] 第 ${item.id} 章：${item.task}`);
      }
    }
    await todo.save(todoFilepath);
  }

  const pending = todo.pending();
  console.log(`\n── 阶段二：写作（共 ${finalChapters.length} 章，待写 ${pending.length} 章）──`);

  if (pending.length === 0) {
    console.log("[完结] 所有章节已完成。");
    return;
  }

  // ── 阶段二：每章独立 subagent ─────────────────────────────
  for (const item of pending) {
    const match = item.task.match(/第(\d+)章/);
    const chapterNum = match ? parseInt(match[1], 10) : item.id;
    const meta = finalChapters.find((c) => c.title === item.task) ?? { title: item.task };

    console.log(`\n[写作] 开始：${item.task}`);
    todo.update(item.id, "in_progress");
    await todo.save(todoFilepath);

    // 故事记忆：_story_so_far.md
    const storySoFar = await fs.readFile(path.join(novelDir, "_story_so_far.md"), "utf-8").catch(() => "");

    // 上一章结尾 600 字
    const prevNum = chapterNum - 1;
    let lastChapterEnding = "";
    if (prevNum >= 1) {
      const prevFiles = await fs.readdir(novelDir).catch((): string[] => []);
      const prevFile = prevFiles.find((f) => f.startsWith(String(prevNum).padStart(3, "0")));
      if (prevFile) {
        const raw = await fs.readFile(path.join(novelDir, prevFile), "utf-8").catch(() => "");
        lastChapterEnding = raw.slice(-600);
      }
    }

    const storySoFarSection = storySoFar
      ? `\n## 故事摘要（截至上章）\n${storySoFar}\n`
      : "";
    const lastChapterSection = lastChapterEnding
      ? `\n## 上一章结尾（保持衔接）\n${lastChapterEnding}\n`
      : "";

    const metaLines: string[] = [];
    if (meta.target_words) metaLines.push(`- 目标字数：${meta.target_words} 字`);
    if (meta.mood) metaLines.push(`- 情绪基调：${meta.mood}`);
    if (meta.required_scenes?.length) metaLines.push(`- 必须出现的场景：${meta.required_scenes.join("、")}`);
    if (meta.plot_hooks?.length) metaLines.push(`- 需要埋下的伏笔：${meta.plot_hooks.join("、")}`);
    const metaSection = metaLines.length > 0 ? `\n## 本章写作要求\n${metaLines.join("\n")}\n` : "";

    const targetWords = meta.target_words ?? 1200;

    const chapterSystem = `你是一位古言言情小说作家，正在创作《${novelTitle}》的${item.task}。

## 写作风格
${styleGuide}
${storySoFarSection}${lastChapterSection}${metaSection}
## 写作规则
- 先用 read_plan 依次读取 outline、characters、relationships，理解全局设定
- 本章不少于 ${targetWords} 字，人物言行必须符合人物设定，剧情必须与故事摘要保持连贯
- 写完后调用 write_chapter 保存，chapter_number=${chapterNum}
- 保存成功后调用 write_story_so_far，更新截至本章的故事摘要（包含本章新发生的事件）
- 最后调用 update_todo 将任务 [${item.id}] 标记为 done
- 完成后回复"本章完成"`;

    const chapterMessages: Message[] = [
      { role: "user", content: `请创作《${novelTitle}》${item.task}。先读规划文件，再写正文，写完保存并更新故事摘要和任务状态。` },
    ];

    const chapterCompactFn = async (): Promise<string> => {
      const compressed = await autoCompress(client, MODEL, chapterMessages, 0);
      return compressed ? "上下文已压缩。" : "压缩失败。";
    };

    const chapterHandlers = makeToolHandlers(novelTitle, todo, chapterCompactFn, todoFilepath);

    await agentLoop(client, MODEL, chapterSystem, chapterMessages, TOOLS_DEFINITION, chapterHandlers, onTool, compactOptions);

    console.log(`[写作] 完成：${item.task}`);
  }

  console.log("\n创作完成！");
}

main().catch(console.error);
