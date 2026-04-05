/**
 * agents/planner.ts - 规划专用 Agent（GSD Specialized Agent 模式）
 *
 * 职责：生成大纲、人物、关系、章节列表
 * 特点：每次调用拿到全新上下文，只注入规划所需的精准信息
 */

import fs from "fs/promises";
import path from "path";
import { agentLoop, type Message, type CompactOptions } from "../agent-loop.js";
import { TOOLS_DEFINITION, makeToolHandlers } from "../tools.js";
import { endpoints } from "../models.js";
import { loadPreferences } from "../knowledge-base.js";
import type { ChapterMeta } from "../novel-agent.js";

// ── 规划类型 ──────────────────────────────────────────────

export type PlanType = "outline" | "characters" | "relationships";

const TYPE_LABELS: Record<PlanType, string> = {
  outline: "故事大纲",
  characters: "人物设定",
  relationships: "人物关系",
};

const TYPE_INSTRUCTIONS: Record<PlanType, string> = {
  outline: "包含：一句话核心冲突、三幕结构、各章节目标、主要情节转折点",
  characters: "每个主要角色：姓名、身份、外貌、性格、核心动机、成长弧",
  relationships: "主要角色之间的关系、矛盾点、情感走向、权力结构",
};

// 前序依赖：characters 依赖 outline，relationships 依赖 outline + characters
const PRIOR_DEPS: Record<PlanType, PlanType[]> = {
  outline: [],
  characters: ["outline"],
  relationships: ["outline", "characters"],
};

// ── 规划 Agent 配置 ──────────────────────────────────────

interface PlanAgentConfig {
  novelTitle: string;
  novelDir: string;
  styleGuide: string;
  existingContext: string;   // 已有章节内容（逆向提取时）
  premise?: string;          // 用户设定的故事前提
  feedback?: string;         // HITL 反馈
  compactOptions: CompactOptions;
  onTool?: (name: string, output: string) => void;
  checkpointFile?: string;   // 检查点文件路径
}

// ── 生成规划文件 ──────────────────────────────────────────

export async function runPlanAgent(
  type: PlanType,
  config: PlanAgentConfig,
): Promise<void> {
  const { novelTitle, novelDir, styleGuide, existingContext, premise, feedback, compactOptions, onTool, checkpointFile } = config;
  // 流式模式下 agentLoop 已显示工具调用，onTool 只打印结果摘要
  const defaultOnTool = (name: string, output: string) => {
    const short = String(output).slice(0, 60).replace(/\n/g, " ");
    console.log(`    → ${short}${output.length > 60 ? "..." : ""}`);
  };

  const handlers = makeToolHandlers(novelTitle);

  // 加载前序规划文件
  const priorSections: string[] = [];
  for (const dep of PRIOR_DEPS[type]) {
    const content = await fs.readFile(path.join(novelDir, `_${dep}.md`), "utf-8").catch(() => null);
    if (content) priorSections.push(`## 已有${TYPE_LABELS[dep]}\n${content}`);
  }
  const priorContext = priorSections.length > 0 ? "\n" + priorSections.join("\n\n") + "\n" : "";

  // 增量修改：如果有 feedback，读取当前规划文件
  let existingPlan = "";
  let isIncremental = false;
  if (feedback) {
    const currentPlan = await fs.readFile(path.join(novelDir, `_${type}.md`), "utf-8").catch(() => null);
    if (currentPlan) {
      existingPlan = `\n## 当前${TYPE_LABELS[type]}（需要修改）\n${currentPlan}\n`;
      isIncremental = true;
    }
  }

  const premiseSection = premise ? `\n## 故事前提（用户设定，必须严格遵守）\n${premise}\n` : "";
  const feedbackSection = feedback ? `\n## 用户反馈（请根据此反馈修改）\n${feedback}\n` : "";
  const userPrefs = await loadPreferences();
  const prefsSection = userPrefs ? `\n## 用户偏好（来自历史反馈，请遵守）\n${userPrefs}\n` : "";

  // 根据是否增量修改，使用不同的指令
  const taskInstruction = isIncremental
    ? `根据用户反馈，对当前${TYPE_LABELS[type]}进行**局部修改**，只调整反馈中提到的部分，其余内容保持不变。不要重新生成整个文档。`
    : `生成${TYPE_LABELS[type]}，要求：${TYPE_INSTRUCTIONS[type]}。必须与已有规划保持一致。`;

  const system = `你是一位资深古言言情小说策划，正在为《${novelTitle}》${isIncremental ? "修改" : "生成"}${TYPE_LABELS[type]}。
${premiseSection}
## 写作风格参考
${styleGuide}
${prefsSection}${existingContext}${priorContext}${existingPlan}${feedbackSection}
## 任务
${taskInstruction}
完成后调用 write_plan(type="${type}") 保存，然后回复"完成"。`;

  // 全新上下文——GSD 核心：每个 agent 拿到干净的 200k 窗口
  const messages: Message[] = [
    { role: "user", content: isIncremental
      ? `请根据用户反馈修改${TYPE_LABELS[type]}，只修改相关部分，保持其他内容不变。`
      : `请为《${novelTitle}》生成${TYPE_LABELS[type]}，完成后保存。`
    },
  ];

  // 加载检查点恢复进度
  if (checkpointFile) {
    const checkpoint = await import("../agent-loop.js").then(m => m.loadCheckpoint(checkpointFile));
    if (checkpoint) {
      console.log(`  📌 从检查点恢复: ${checkpoint.lastTool} @ ${checkpoint.timestamp}`);
      messages.length = 0; // 清空
      messages.push(...checkpoint.messages);
    }
  }

  await agentLoop(
    endpoints.plan.client, endpoints.plan.model,
    system, messages, TOOLS_DEFINITION, handlers,
    onTool ?? defaultOnTool, compactOptions, undefined,
    checkpointFile,
  );

  // 工具调用可靠性检查：验证文件是否生成
  const planPath = path.join(novelDir, `_${type}.md`);
  let planExists = await fs.access(planPath).then(() => true).catch(() => false);

  if (!planExists) {
    console.error(`⚠️  write_plan(type="${type}") 未被调用，尝试重试...`);

    // 追加强制提示
    messages.push({
      role: "user",
      content: `请立即调用 write_plan(type="${type}") 工具保存${TYPE_LABELS[type]}。`
    });

    // 再跑一轮
    await agentLoop(
      endpoints.plan.client, endpoints.plan.model,
      system, messages, TOOLS_DEFINITION, handlers,
      onTool ?? defaultOnTool, compactOptions, undefined,
      checkpointFile,
    );

    // 再次检查
    planExists = await fs.access(planPath).then(() => true).catch(() => false);
    if (!planExists) {
      throw new Error(`${TYPE_LABELS[type]}生成失败：模型未调用 write_plan 工具`);
    }
  }
}

// ── 章节列表 Agent ────────────────────────────────────────

export async function runChapterProposalAgent(
  config: PlanAgentConfig,
): Promise<ChapterMeta[]> {
  const { novelTitle, novelDir, styleGuide, existingContext, premise, feedback, compactOptions, onTool, checkpointFile } = config;
  // 流式模式下 agentLoop 已显示工具调用，onTool 只打印结果摘要
  const defaultOnTool = (name: string, output: string) => {
    const short = String(output).slice(0, 60).replace(/\n/g, " ");
    console.log(`    → ${short}${output.length > 60 ? "..." : ""}`);
  };

  let proposedTitles: string[] = [];
  const handlers = makeToolHandlers(novelTitle, undefined, undefined, undefined, (ch) => { proposedTitles = ch; });

  const premiseSection = premise ? `\n## 故事前提（用户设定，必须严格遵守）\n${premise}\n` : "";
  const feedbackSection = feedback ? `\n## 用户反馈\n${feedback}\n` : "";

  // 用骨架提取替代全文注入，大幅减少 input tokens（34KB → ~4KB）
  const { extractSkeleton } = await import("../plan-skeleton.js");
  const outlineRaw = await fs.readFile(path.join(novelDir, "_outline.md"), "utf-8").catch(() => "");
  const charactersRaw = await fs.readFile(path.join(novelDir, "_characters.md"), "utf-8").catch(() => "");
  const relationshipsRaw = await fs.readFile(path.join(novelDir, "_relationships.md"), "utf-8").catch(() => "");

  const planContext = [
    outlineRaw && `## 故事大纲（骨架）\n${extractSkeleton(outlineRaw)}`,
    charactersRaw && `## 人物设定（骨架）\n${extractSkeleton(charactersRaw)}`,
    relationshipsRaw && `## 人物关系\n${relationshipsRaw}`, // 关系文件本身不大，保留全文
  ].filter(Boolean).join("\n\n");

  const system = `你是一位资深古言言情小说策划，正在为《${novelTitle}》规划章节列表。
${premiseSection}
## 写作风格参考
${styleGuide}
${existingContext}${feedbackSection}
${planContext}

## 任务
直接调用 propose_chapters 提交章节列表（不需要先读取规划文件，上面已经提供了）。
- 每章使用对象格式，包含：title（标题）、target_words（目标字数）、mood（情绪基调）、required_scenes（必须出现的场景）、plot_hooks（需要埋下的伏笔）、transition_notes（场景过渡说明：本章各场景之间如何自然衔接，以及与上一章的衔接方式）
- 章节数量根据故事体量自主决定（建议 5-15 章）
- 如果已有章节文件，续写章节编号从已有章节之后开始
完成后回复"完成"。`;

  const messages: Message[] = [
    { role: "user", content: `请为《${novelTitle}》规划章节列表。` },
  ];

  await agentLoop(
    endpoints.plan.client, endpoints.plan.model,
    system, messages, TOOLS_DEFINITION, handlers,
    onTool ?? defaultOnTool, compactOptions, undefined,
    checkpointFile,
  );

  // 从文件读取完整元数据
  const chaptersPath = path.join(novelDir, "_chapters.json");
  let raw = await fs.readFile(chaptersPath, "utf-8").catch(() => null);

  // 工具调用可靠性检查：如果文件不存在且回调也没拿到数据，重试一次
  if (!raw && proposedTitles.length === 0) {
    console.error("⚠️  propose_chapters 未被调用，尝试重试...");

    // 追加强制提示
    messages.push({
      role: "user",
      content: "请立即调用 propose_chapters 工具提交章节列表。"
    });

    // 再跑一轮
    await agentLoop(
      endpoints.plan.client, endpoints.plan.model,
      system, messages, TOOLS_DEFINITION, handlers,
      onTool ?? defaultOnTool, compactOptions, undefined,
      checkpointFile,
    );

    // 再次检查
    raw = await fs.readFile(chaptersPath, "utf-8").catch(() => null);
    if (!raw && proposedTitles.length === 0) {
      throw new Error("章节列表生成失败：模型未调用 propose_chapters 工具");
    }
  }

  if (raw) {
    const parsed = JSON.parse(raw) as (string | ChapterMeta)[];
    return parsed.map((c) => (typeof c === "string" ? { title: c } : c));
  }
  return proposedTitles.map((t) => ({ title: t }));
}
