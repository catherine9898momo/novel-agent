/**
 * agents/writer.ts - 写作专用 Agent（GSD Specialized Agent 模式）
 *
 * 职责：每章独立写作，拿到全新上下文
 * 核心：精准注入——只注入本章写作所需的最小上下文集
 *
 * 注入清单（GSD Context Engineering）：
 *   1. 风格指南（始终加载）
 *   2. 大纲 + 人物 + 关系（结构化设定）
 *   3. XML 章节计划（精确指令）
 *   4. 故事摘要（story_so_far，而非全部前文）
 *   5. 上章结尾 2000 字 + 交接备忘
 *   6. 当前伏笔状态
 *   7. 角色声音档案
 *   8. 情绪曲线位置
 *   9. 知识库素材（按标签检索）
 *   10. 用户偏好
 */

import fs from "fs/promises";
import path from "path";
import { agentLoop, type Message, type CompactOptions } from "../agent-loop.js";
import { TOOLS_DEFINITION, makeToolHandlers } from "../tools.js";
import { autoCompress } from "../context-compact.js";
import { endpoints } from "../models.js";
import { getRelevantMaterial, loadPreferences } from "../knowledge-base.js";
import type { TodoList } from "../todo.js";
import type { ChapterMeta } from "../novel-agent.js";
import type { ChapterPlan } from "../xml-plan.js";
import { planToXml } from "../xml-plan.js";

// ── 写作上下文（精准注入所需的全部信息）──────────────────

export interface WriteContext {
  novelTitle: string;
  novelDir: string;
  styleGuide: string;
  chapterNum: number;
  chapterTitle: string;
  meta: ChapterMeta;

  // 结构化设定
  outline: string;
  characters: string;
  relationships: string;

  // 章节计划（XML 格式或自由文本）
  chapterPlan: ChapterPlan | string;

  // 故事记忆（精准投喂，不堆砌）
  storySoFar: string;
  lastChapterEnding: string;
  lastHandoff: string;

  // 伏笔状态
  foreshadowing: Array<{ desc: string; planted_at: string; status: string; expected_resolution: string }>;

  // 角色声音档案
  voiceProfiles: string;

  // 情绪曲线
  moodEntries: string[];

  // 运行时
  todo: TodoList;
  todoFilepath: string;
  compactOptions: CompactOptions;
  onTool?: (name: string, output: string) => void;
}

// ── 构建写作 system prompt ───────────────────────────────

function buildWriterSystem(ctx: WriteContext): string {
  const { meta, chapterNum } = ctx;
  const targetWords = meta.target_words ?? 2000;

  // 章节计划：优先 XML 格式
  const planSection = typeof ctx.chapterPlan === "string"
    ? ctx.chapterPlan
    : planToXml(ctx.chapterPlan);

  // 情绪曲线位置
  const moodPositionSection = ctx.moodEntries.length > 0
    ? `\n## 情绪曲线（>>>标记当前章节位置，*标记已完成章节）\n${ctx.moodEntries.join("\n")}\n`
    : "";

  // 故事记忆
  const storySoFarSection = ctx.storySoFar
    ? `\n## 故事摘要（截至上章）\n${ctx.storySoFar}\n`
    : "";
  const lastChapterSection = ctx.lastChapterEnding
    ? `\n## 上一章结尾（保持衔接）\n${ctx.lastChapterEnding}\n`
    : "";
  const handoffSection = ctx.lastHandoff
    ? `\n## 上一章交接备忘（衔接重点）\n${ctx.lastHandoff}\n`
    : "";

  // 伏笔
  const activeForeshadowing = ctx.foreshadowing.filter(f => f.status !== "已回收");
  const foreshadowingSection = activeForeshadowing.length > 0
    ? `\n## 当前未回收伏笔\n${activeForeshadowing.map(f => `- [${f.status}] ${f.desc}（埋于${f.planted_at}，预期回收：${f.expected_resolution}）`).join("\n")}\n`
    : "";

  // 本章写作要求
  const metaLines: string[] = [];
  if (meta.target_words) metaLines.push(`- 目标字数：${meta.target_words} 字`);
  if (meta.mood) metaLines.push(`- 情绪基调：${meta.mood}`);
  if (meta.required_scenes?.length) metaLines.push(`- 必须出现的场景：${meta.required_scenes.join("、")}`);
  if (meta.plot_hooks?.length) metaLines.push(`- 需要埋下的伏笔：${meta.plot_hooks.join("、")}`);
  if (meta.transition_notes) metaLines.push(`- 场景过渡说明：${meta.transition_notes}（场景切换需有情绪或环境的自然过渡，禁止硬切）`);
  const metaSection = metaLines.length > 0 ? `\n## 本章写作要求\n${metaLines.join("\n")}\n` : "";

  return `你是一位古言言情小说作家，正在创作《${ctx.novelTitle}》的${ctx.chapterTitle}。

## 写作风格
${ctx.styleGuide}

## 故事大纲
${ctx.outline}

## 人物设定
${ctx.characters}

## 人物关系
${ctx.relationships}
${ctx.voiceProfiles ? `\n## 角色声音档案（对话时严格保持各角色的语言风格一致性）\n${ctx.voiceProfiles}\n` : ""}${moodPositionSection}${storySoFarSection}${lastChapterSection}${handoffSection}${foreshadowingSection}${metaSection}
## 本章写作计划（请严格按此计划创作）
${planSection}

## 写作规则
- 本章不少于 ${targetWords} 字，人物言行必须符合人物设定，剧情必须与故事摘要保持连贯
- 场景切换必须有情绪或环境的自然过渡，禁止硬切
- 写完后调用 write_chapter 保存，chapter_number=${chapterNum}
- 保存成功后调用 write_story_so_far，更新截至本章的故事摘要（包含本章新发生的事件）
- 然后调用 write_handoff，写本章交接备忘（结尾情绪状态、未完成的对话或动作、需要下一章衔接的线索，200字以内）
- 然后调用 update_foreshadowing，更新本章涉及的伏笔状态（新埋的、推进的、已回收的）
- 最后调用 update_todo 将任务 [${ctx.todo.pending().find(i => i.task === ctx.chapterTitle)?.id ?? chapterNum}] 标记为 done
- 完成后回复"本章完成"`;
}

// ── 执行写作 ──────────────────────────────────────────────

export interface WriteResult {
  success: boolean;
  filePath?: string;
  content?: string;
  system: string;     // 供重写时修改后复用
}

export async function runWriterAgent(ctx: WriteContext): Promise<WriteResult> {
  const defaultOnTool = (name: string, output: string) =>
    console.log(`  [工具] ${name}: ${String(output).slice(0, 80)}`);

  // 注入知识库素材
  const knowledgeMaterial = await getRelevantMaterial(
    ctx.meta.mood,
    ctx.meta.required_scenes,
    3,
  );
  const userPrefs = await loadPreferences();

  let system = buildWriterSystem(ctx);

  // 知识库和用户偏好注入到风格部分之后
  if (knowledgeMaterial) {
    system = system.replace(
      "## 故事大纲",
      `${knowledgeMaterial}\n## 故事大纲`,
    );
  }
  if (userPrefs) {
    system = system.replace(
      "## 故事大纲",
      `\n## 用户写作偏好（必须遵守，来自历史反馈沉淀）\n${userPrefs}\n\n## 故事大纲`,
    );
  }

  // 全新上下文——GSD 核心：每个 executor 拿到干净的 200k 窗口
  const messages: Message[] = [
    { role: "user", content: `请创作《${ctx.novelTitle}》${ctx.chapterTitle}。直接写正文，写完保存并更新故事摘要和任务状态。` },
  ];

  const compactFn = async (): Promise<string> => {
    const compressed = await autoCompress(
      endpoints.compress.client, endpoints.compress.model, messages, 0,
    );
    return compressed ? "上下文已压缩。" : "压缩失败。";
  };

  const handlers = makeToolHandlers(ctx.novelTitle, ctx.todo, compactFn, ctx.todoFilepath);

  await agentLoop(
    endpoints.write.client, endpoints.write.model,
    system, messages, TOOLS_DEFINITION, handlers,
    ctx.onTool ?? defaultOnTool, ctx.compactOptions,
  );

  // 读取写好的章节文件
  const prefix = String(ctx.chapterNum).padStart(3, "0");
  const writtenFiles = await fs.readdir(ctx.novelDir).catch((): string[] => []);
  const writtenFile = writtenFiles.find((f) => f.startsWith(prefix) && !f.startsWith("_"));

  if (!writtenFile) {
    return { success: false, system };
  }

  const content = await fs.readFile(path.join(ctx.novelDir, writtenFile), "utf-8").catch(() => "");
  return {
    success: true,
    filePath: path.join(ctx.novelDir, writtenFile),
    content,
    system,
  };
}

// ── 重写前清理 ──────────────────────────────────────────────

export async function cleanupForRewrite(novelDir: string, chapterNum: number): Promise<void> {
  const prefix = String(chapterNum).padStart(3, "0");
  const files = await fs.readdir(novelDir).catch((): string[] => []);
  const existing = files.find((f) => f.startsWith(prefix) && !f.startsWith("_"));
  if (existing) {
    await fs.unlink(path.join(novelDir, existing)).catch(() => null);
    console.log(`[重写] 已删除旧版本：${existing}`);
  }
}
