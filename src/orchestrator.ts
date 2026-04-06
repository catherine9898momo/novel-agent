/**
 * orchestrator.ts - 薄编排层（GSD Thin Orchestrator 模式）
 *
 * GSD 核心理念：编排器不做重活，只负责 spawn → wait → integrate → route
 *
 * 职责：
 *   1. 检测当前阶段，决定下一步
 *   2. 按阶段调度专用 Agent（planner / researcher / writer / reviewer）
 *   3. 管理 HITL 确认循环
 *   4. 维护 STATE.md（跨会话记忆）
 *   5. 每个 Agent 拿到全新上下文（精准注入，不堆砌）
 *
 * 流程：
 *   init → planning → analysis → writing(每章循环) → reviewing → complete
 *         ↑                                              │
 *         └──────────── 新 milestone ←───────────────────┘
 */

import fs from "fs/promises";
import path from "path";
import { askLine } from "./cli.js";
import type { CompactOptions } from "./agent-loop.js";
import type { ChapterMeta } from "./novel-agent.js";
import { NovelState } from "./novel-state.js";
import { TodoList } from "./todo.js";
import { endpoints, printModelConfig } from "./models.js";
import { printKnowledgeStats, appendPreference, addEntry } from "./knowledge-base.js";

// Specialized Agents
import { runPlanAgent, runChapterProposalAgent, type PlanType } from "./agents/planner.js";
import { runWriterAgent, cleanupForRewrite, generateOpeningVariants, polishChapter, type WriteContext } from "./agents/writer.js";
import { reviewChapter, verifyAgainstPlan, runCoherenceAudit } from "./agents/reviewer.js";
import { runAnalysisAgent, extractVoiceProfiles, loadExistingChaptersText, type AnalysisResult } from "./agents/researcher.js";
import { generateXmlChapterPlan, planToXml, type ChapterPlan } from "./xml-plan.js";

// ── 工具函数 ──────────────────────────────────────────────

async function loadStyle(styleName: string): Promise<string> {
  const p = path.resolve("skills", "styles", `${styleName}.md`);
  return await fs.readFile(p, "utf-8").catch(() => "");
}

// ── HITL 确认（GSD verify-work 模式）────────────────────

async function hitlGate(
  label: string,
  getContent: () => Promise<string>,
  regenerate: (feedback: string) => Promise<void>,
): Promise<void> {
  // 首次：如果内容为空则先生成
  let firstContent = await getContent().catch(() => "");
  if (!firstContent.trim()) {
    await regenerate("");
  }
  while (true) {
    const content = await getContent();
    console.log(`\n── [${label}] 已生成 ${"─".repeat(Math.max(0, 40 - label.length))}`);
    console.log(content);
    console.log("─".repeat(50));
    const answer = await askLine(`确认 ${label}？(y / 输入修改意见重新生成) `);
    if (answer.toLowerCase() === "y") return;
    await appendPreference(answer, `规划阶段 - ${label}`);
    console.log(`\n[${label}] 根据反馈重新生成...（反馈已沉淀）`);
    await regenerate(answer);
  }
}

// ── 状态检测 ──────────────────────────────────────────────

export interface DetectedFiles {
  hasOutline: boolean;
  hasCharacters: boolean;
  hasRelationships: boolean;
  hasChapters: boolean;
  hasStorySoFar: boolean;
  chaptersHaveMetadata: boolean;
  existingChapterNums: number[];
}

export async function detectFiles(novelDir: string): Promise<DetectedFiles> {
  const files = await fs.readdir(novelDir).catch((): string[] => []);
  const existingChapterNums = files
    .filter((f) => /^\d{3}-/.test(f) && f.endsWith(".md"))
    .map((f) => parseInt(f.slice(0, 3), 10));

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

async function loadChapters(novelDir: string): Promise<ChapterMeta[] | null> {
  const raw = await fs.readFile(path.join(novelDir, "_chapters.json"), "utf-8").catch(() => null);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as (string | ChapterMeta)[];
  return parsed.map((c) => (typeof c === "string" ? { title: c } : c));
}

// ── 编排器主类 ──────────────────────────────────────────────

export type GenerationMode =
  | "skeleton"  // 只生成框架
  | "chapter"   // 生成单章
  | "batch"     // 批量生成多章
  | "full";     // 一次性生成全部（当前默认）

export class Orchestrator {
  private novelTitle: string;
  private novelDir: string;
  private styleGuide: string = "";
  private state!: NovelState;
  private compactOptions: CompactOptions;
  private mode: GenerationMode;

  constructor(novelTitle: string, novelDir: string, mode: GenerationMode = "skeleton") {
    this.novelTitle = novelTitle;
    this.novelDir = novelDir;
    this.mode = mode;
    this.compactOptions = {
      enableMicro: true,
      keepLast: 3,
      threshold: 80_000,
      compressClient: endpoints.compress.client,
      compressModel: endpoints.compress.model,
    };
  }

  // 流式模式下 agentLoop 已显示工具调用进度，onTool 只打印结果摘要
  private onTool = (name: string, output: string) => {
    const short = String(output).slice(0, 60).replace(/\n/g, " ");
    console.log(`    → ${short}${output.length > 60 ? "..." : ""}`);
  };

  // ── 主入口 ──────────────────────────────────────────────

  async run(): Promise<void> {
    await fs.mkdir(this.novelDir, { recursive: true });

    // 加载风格指南
    this.styleGuide = await loadStyle("ancient-romance");

    // 加载/创建 STATE（GSD STATE.md 模式）
    this.state = await NovelState.load(this.novelDir, this.novelTitle, "ancient-romance");

    printModelConfig();
    await printKnowledgeStats();
    console.log(`\n── 《${this.novelTitle}》[模式: ${this.mode}] ──────────────────────────────`);

    // 开始新会话
    await this.state.startSession();

    // 清理孤立草稿
    await this.cleanupDrafts();

    // 根据模式选择流程
    if (this.mode === "skeleton") {
      await this.runSkeletonMode();
      return;
    }

    // 检测是否有未完成的章节（断点续传）
    const unfinished = this.state.getUnfinishedChapters();
    if (unfinished.length > 0) {
      const first = unfinished[0];
      console.log(`\n检测到未完成章节：第 ${first.chapterNum} 章 (${first.status})`);
      const answer = await askLine("是否从断点继续？(y/n) ");

      if (answer === "y") {
        await this.resumeFromCheckpoint(first);
        return;
      }
    }

    // 按阶段调度（GSD phase routing）
    await this.phasePlanning();
    await this.phaseAnalysis();
    await this.phaseWriting();

    // 结束会话
    await this.state.pauseSession(["检查完结状态"]);
    console.log("\n创作完成！");
  }

  // ── Phase 1: 规划 ──────────────────────────────────────

  private async phasePlanning(): Promise<void> {
    await this.state.setPhase("planning");
    console.log("\n── 阶段一：规划 ──────────────────────────────────");

    const detected = await detectFiles(this.novelDir);
    const hasAnyChapters = detected.existingChapterNums.length > 0;
    const existingContext = await loadExistingChaptersText(this.novelDir, detected.existingChapterNums);
    const premise = await fs.readFile(path.join(this.novelDir, "_premise.md"), "utf-8").catch(() => "");
    if (premise) console.log("[前提] 已加载 _premise.md");

    // 生成缺失的规划文件
    const missingPlan = [
      !detected.hasOutline && "outline" as const,
      !detected.hasCharacters && "characters" as const,
      !detected.hasRelationships && "relationships" as const,
    ].filter(Boolean) as PlanType[];

    if (missingPlan.length > 0) {
      if (hasAnyChapters) {
        console.log(`[检测] 发现 ${detected.existingChapterNums.length} 个已有章节，将基于已有内容逆向提取规划`);
      }

      for (const type of missingPlan) {
        console.log(`\n[规划] 生成 ${type}...`);

        const planConfig = {
          novelTitle: this.novelTitle,
          novelDir: this.novelDir,
          styleGuide: this.styleGuide,
          existingContext,
          premise: premise || undefined,
          compactOptions: this.compactOptions,
          onTool: this.onTool,
          checkpointFile: path.join(this.novelDir, "_checkpoint.json"),
        };

        await runPlanAgent(type, planConfig);

        await hitlGate(
          type,
          () => fs.readFile(path.join(this.novelDir, `_${type}.md`), "utf-8"),
          async (feedback) => {
            await this.state.addDecision("planning", type, feedback, "HITL 反馈重新生成");
            await runPlanAgent(type, { ...planConfig, feedback });
          },
        );

        await this.state.markPlanningDone(type);
        await this.state.addAccomplishment(`${type} 规划完成`);
      }
    } else {
      console.log("[规划] outline / characters / relationships 均已存在，跳过");
    }

    // 章节列表
    if (!detected.hasChapters) {
      console.log("\n[规划] 生成章节列表...");

      const planConfig = {
        novelTitle: this.novelTitle,
        novelDir: this.novelDir,
        styleGuide: this.styleGuide,
        existingContext,
        premise: premise || undefined,
        compactOptions: this.compactOptions,
        onTool: this.onTool,
        checkpointFile: path.join(this.novelDir, "_checkpoint.json"),
      };

      await runChapterProposalAgent(planConfig);

      await hitlGate(
        "章节列表",
        async () => {
          const ch = await loadChapters(this.novelDir);
          return ch ? ch.map((c, i) => `${i + 1}. ${c.title}`).join("\n") : "（未生成）";
        },
        async (feedback) => {
          await this.state.addDecision("planning", "章节列表", feedback);
          await runChapterProposalAgent({ ...planConfig, feedback });
        },
      );

      await this.state.markPlanningDone("chapters");
      await this.state.addAccomplishment("章节列表规划完成");
    } else {
      console.log("[规划] _chapters.json 已存在，跳过");
    }
  }

  // ── Phase 1.5: 全文分析 ────────────────────────────────

  private async phaseAnalysis(): Promise<void> {
    const detected = await detectFiles(this.novelDir);
    const hasWrittenChapters = detected.existingChapterNums.length > 0;
    const needsAnalysis = hasWrittenChapters && (!detected.hasStorySoFar || !detected.chaptersHaveMetadata);

    if (!needsAnalysis) return;

    await this.state.setPhase("analysis");

    const result = await runAnalysisAgent(
      this.novelTitle, this.novelDir, this.styleGuide,
      {
        hasOutline: detected.hasOutline,
        hasCharacters: detected.hasCharacters,
        hasRelationships: detected.hasRelationships,
        hasChapters: detected.hasChapters,
        hasStorySoFar: detected.hasStorySoFar,
        chaptersHaveMetadata: detected.chaptersHaveMetadata,
        existingChapterNums: detected.existingChapterNums,
      },
    );

    if (!result) return;

    // 展示分析结果
    this.printAnalysisResult(result, detected);

    const confirm = await askLine("\n确认分析结果并写入文件？(y / n) ");
    if (confirm.toLowerCase() !== "y") {
      console.log("[分析] 已跳过，继续使用现有文件");
      return;
    }

    // 写入文件
    await this.writeAnalysisFiles(result, detected);
    await this.handleMissingChapters(detected);

    await this.state.addAccomplishment("全文分析完成");
    console.log("\n[分析] 全文分析完成，进入写作阶段");
  }

  // ── Phase 2: 写作 ──────────────────────────────────────

  private async phaseWriting(): Promise<void> {
    await this.state.setPhase("writing");

    const detected = await detectFiles(this.novelDir);
    const chapters = (await loadChapters(this.novelDir)) ?? [];

    if (chapters.length === 0) {
      console.error("[错误] 无法获取章节列表");
      return;
    }

    await this.state.updateStats({ chaptersTotal: chapters.length });

    // 恢复/创建 TodoList
    const todoFilepath = path.join(this.novelDir, "_todo.json");
    const { todo, pending } = await this.initTodoList(todoFilepath, chapters, detected);

    console.log(`\n── 阶段二：写作（共 ${chapters.length} 章，待写 ${pending.length} 章）──`);

    if (pending.length === 0) {
      console.log("[完结] 所有章节已完成。");
      await this.state.setPhase("complete");
      return;
    }

    // 提取角色声音档案
    const voiceProfiles = await extractVoiceProfiles(this.novelDir, detected.existingChapterNums);

    // 每章独立 Agent（GSD: fresh context per executor）
    for (const item of pending) {
      const match = item.task.match(/第(\d+)章/);
      const chapterNum = match ? parseInt(match[1], 10) : item.id;
      const meta = chapters.find((c) => c.title === item.task) ?? { title: item.task };

      console.log(`\n[写作] 开始：${item.task}`);
      await this.state.setCurrentChapter(chapterNum);

      // 打印情绪曲线
      this.printMoodCurve(chapters, chapterNum, detected.existingChapterNums);

      todo.update(item.id, "in_progress");
      await todo.save(todoFilepath);

      // 加载本章所需的精准上下文
      const writeCtx = await this.buildWriteContext(
        chapterNum, item.task, meta, chapters, detected,
        voiceProfiles, todo, todoFilepath,
      );

      // ── XML 章节计划（GSD Plan Phase）──
      const chapterPlan = await this.planChapter(
        chapterNum, item.task, meta, writeCtx,
      );
      writeCtx.chapterPlan = chapterPlan;

      // ── 写作 + 自评重写循环（GSD Execute + Verify）──
      await this.writeAndVerifyChapterLegacy(
        item, chapterNum, meta, chapterPlan, writeCtx, todo, todoFilepath,
      );

      console.log(`[写作] 完成：${item.task}`);
      await this.state.addAccomplishment(`${item.task} 写作完成`);

      // 每 5 章触发连贯性审计
      const doneCount = chapters.length - todo.pending().length;
      if (doneCount > 0 && doneCount % 5 === 0) {
        await runCoherenceAudit(this.novelTitle, this.novelDir, this.styleGuide, doneCount);
        await askLine("按 Enter 继续写作...");
      }
    }
  }

  // ── 章节计划（XML Plan）────────────────────────────────

  private async planChapter(
    chapterNum: number,
    chapterTitle: string,
    meta: ChapterMeta,
    writeCtx: WriteContext,
  ): Promise<ChapterPlan> {
    let plan: ChapterPlan | null = null;
    let planApproved = false;

    while (!planApproved) {
      console.log(`\n[计划] 正在生成 ${chapterTitle} 写作计划（XML 格式）...`);

      const foreshadowingState = writeCtx.foreshadowing.length > 0
        ? writeCtx.foreshadowing.map(f => `- [${f.status}] ${f.desc}（${f.planted_at}）`).join("\n")
        : "";

      plan = await generateXmlChapterPlan(
        this.novelTitle, chapterTitle, meta, this.styleGuide,
        writeCtx.storySoFar, writeCtx.lastChapterEnding,
        writeCtx.outline, writeCtx.characters,
        foreshadowingState,
        plan ? undefined : undefined, // feedback handled below
      );

      // 展示 XML 计划
      const xmlOutput = planToXml(plan);
      console.log(`\n── [${chapterTitle} 写作计划] ${"─".repeat(20)}`);
      console.log(xmlOutput);
      console.log("─".repeat(50));

      const answer = await askLine("确认此写作计划？(y / 输入修改意见重新生成) ");
      if (answer.toLowerCase() === "y") {
        planApproved = true;
        await this.state.addDecision("writing", `${chapterTitle} 计划`, "确认");
      } else {
        meta.transition_notes = (meta.transition_notes ? meta.transition_notes + "；" : "") + answer;
        await this.state.addDecision("writing", `${chapterTitle} 计划`, answer, "要求修改");
      }
    }

    return plan!;
  }

  // ── 写作 + 自评重写循环（旧版本，用于 phaseWriting）────────────────────────────────

  private async writeAndVerifyChapterLegacy(
    item: { id: number; task: string },
    chapterNum: number,
    meta: ChapterMeta,
    chapterPlan: ChapterPlan,
    writeCtx: WriteContext,
    todo: TodoList,
    todoFilepath: string,
  ): Promise<void> {
    const MAX_REWRITES = 3;
    const REVIEW_THRESHOLD = 4;
    let writeAttempt = 0;
    let chapterAccepted = false;

    while (!chapterAccepted && writeAttempt < MAX_REWRITES) {
      writeAttempt++;
      if (writeAttempt > 1) {
        console.log(`\n[重写] 第 ${writeAttempt} 次尝试：${item.task}`);
        await cleanupForRewrite(this.novelDir, chapterNum);
      }

      // 多版本开头选择（仅首次写作时触发）
      if (writeAttempt === 1) {
        try {
          console.log(`\n[多版本] 生成开头备选...`);
          const chosenOpening = await generateOpeningVariants(writeCtx);
          if (chosenOpening) {
            // 将选中的开头注入写作上下文的 meta
            writeCtx.meta = {
              ...writeCtx.meta,
              transition_notes: (writeCtx.meta.transition_notes ?? "") +
                `\n\n## 用户选定的开头（必须以此为第一段，在此基础上续写）\n${chosenOpening}`,
            };
          }
        } catch (err) {
          console.log(`[多版本] 生成失败，跳过：${(err as Error).message}`);
        }
      }

      // 执行写作 Agent（全新上下文）
      const result = await runWriterAgent(writeCtx);

      if (!result.success || !result.content) {
        console.log("[自评] 未找到章节文件，跳过自评");
        chapterAccepted = true;
        break;
      }

      // HITL：用户审阅
      console.log(`\n── [${item.task} 正文] ${"─".repeat(20)}`);
      console.log(result.content);
      console.log("─".repeat(50));

      const userReview = await askLine("审阅章节：(y=通过并自评 / s=直接通过跳过自评 / 输入修改意见重写) ");

      if (userReview.toLowerCase() === "s") {
        chapterAccepted = true;
        console.log("[审阅] 用户直接通过，跳过自评");
        break;
      } else if (userReview.toLowerCase() !== "y") {
        await appendPreference(userReview, `章节审阅 - ${item.task}`);
        console.log("[审阅] 根据用户反馈重写...（反馈已沉淀）");
        // 注入用户反馈到下次写作上下文
        writeCtx.meta = {
          ...writeCtx.meta,
          transition_notes: (writeCtx.meta.transition_notes ?? "") + `；用户修改意见：${userReview}`,
        };
        await this.state.updateStats({ totalRewrites: (this.state.data.stats.totalRewrites + 1) });
        continue;
      }

      // ── Verify Phase（GSD 模式：验证是一等公民）──
      // 1. XML Plan 验证
      const verifyResult = await verifyAgainstPlan(result.content, chapterPlan, meta);
      console.log(`\n[验证] ${verifyResult.summary}`);

      // 2. 章节自评
      console.log(`[自评] 正在评审 ${item.task}...`);
      const review = await reviewChapter(this.novelTitle, item.task, result.content, meta, this.styleGuide);

      console.log(`[自评] 评分：${review.score}/5 — ${review.feedback}`);
      if (review.weak_sections.length > 0) {
        console.log(`[自评] 薄弱点：${review.weak_sections.join("；")}`);
      }
      if (review.weak_spots && review.weak_spots.length > 0) {
        console.log(`\n── [需要人工打磨的段落] ${"─".repeat(20)}`);
        for (const spot of review.weak_spots) {
          console.log(`  📍 "${spot.excerpt}"`);
          console.log(`     问题：${spot.issue}`);
          console.log(`     建议：${spot.suggestion}\n`);
        }
        console.log("─".repeat(50));
      }

      // 记录评分
      await this.state.recordChapterScore(chapterNum, review.score);

      if (review.score >= REVIEW_THRESHOLD) {
        console.log(`[自评] 通过（${review.score}分）`);

        // HITL：润色入口 — 用户可指定风格目标让 AI 定向打磨
        let finalContent = result.content;
        const polishAnswer = await askLine('润色？(直接回车跳过 / 输入润色指令，如「对话更克制」「加强环境描写」) ');
        if (polishAnswer && polishAnswer.trim() !== "") {
          console.log(`[润色] 按指令打磨中...`);
          const polishResult = await polishChapter(
            finalContent, polishAnswer.trim(), this.styleGuide, review.weak_spots,
          );
          console.log(`\n── [润色结果] ${"─".repeat(20)}`);
          console.log(polishResult.polished.slice(0, 500) + (polishResult.polished.length > 500 ? "\n...（已截断预览）" : ""));
          console.log(`\n[修改说明] ${polishResult.changes}`);
          console.log("─".repeat(50));

          const acceptPolish = await askLine("接受润色结果？(y=接受并覆盖 / n=保留原文) ");
          if (acceptPolish.toLowerCase() === "y" && result.filePath) {
            await fs.writeFile(result.filePath, polishResult.polished, "utf-8");
            finalContent = polishResult.polished;
            console.log("[润色] 已覆盖保存");
            await appendPreference(polishAnswer.trim(), `润色指令 - ${item.task}`);
          } else {
            console.log("[润色] 保留原文");
          }
        }

        chapterAccepted = true;

        // 高分章节自动提取佳段
        if (review.score >= 5 && finalContent.length > 500) {
          const tags = [meta.mood || "通用", ...(meta.required_scenes || []).slice(0, 2)];
          const midStart = Math.floor(finalContent.length * 0.3);
          const excerpt = finalContent.slice(midStart, midStart + 400).trim();
          await addEntry("example", tags, `《${this.novelTitle}》${item.task}`, excerpt, "自评满分章节");
          console.log(`[知识库] 已提取佳段（标签：${tags.join("、")}）`);
        }

        // 更新统计
        const wordCount = finalContent.replace(/\s/g, "").length;
        await this.state.updateStats({
          chaptersCompleted: this.state.data.stats.chaptersCompleted + 1,
          totalWords: this.state.data.stats.totalWords + wordCount,
        });
      } else if (writeAttempt < MAX_REWRITES) {
        console.log(`[自评] 不及格（${review.score}分），触发重写...`);
        writeCtx.meta = {
          ...writeCtx.meta,
          transition_notes: (writeCtx.meta.transition_notes ?? "") +
            `；上次写作问题：${review.feedback}；薄弱点：${review.weak_sections.join("；")}`,
        };
        await this.state.updateStats({ totalRewrites: (this.state.data.stats.totalRewrites + 1) });
      } else {
        console.log(`[自评] 已达最大重写次数（${MAX_REWRITES}次），保留当前版本`);
        chapterAccepted = true;
      }
    }
  }

  // ── 新版写作方法（用于骨架模式和断点续传）────────────────────────────────

  private async writeAndVerifyChapter(chapterNum: number): Promise<void> {
    // 加载章节元数据
    const chapters = (await loadChapters(this.novelDir)) ?? [];
    const meta = chapters[chapterNum - 1];
    if (!meta) {
      throw new Error(`第 ${chapterNum} 章元数据不存在`);
    }

    const chapterTitle = meta.title;
    const MAX_REWRITES = 3;
    const REVIEW_THRESHOLD = 4;

    // 获取当前章节进度
    let progress = this.state.getChapterProgress(chapterNum);
    if (!progress) {
      await this.state.updateChapterProgress(chapterNum, "pending");
      progress = this.state.getChapterProgress(chapterNum)!;
    }

    let writeAttempt = progress.attempts;
    let chapterAccepted = false;

    // 构建写作上下文（简化版）
    const detected = await detectFiles(this.novelDir);
    const voiceProfiles = await fs.readFile(
      path.join(this.novelDir, "_voice_profiles.md"),
      "utf-8"
    ).catch(() => "");
    const todo = new TodoList();
    const todoFilepath = path.join(this.novelDir, "_todo.json");

    const writeCtx = await this.buildWriteContext(
      chapterNum, chapterTitle, meta, chapters, detected, voiceProfiles, todo, todoFilepath
    );

    // 生成章节计划
    const chapterPlan = await this.planChapter(chapterNum, chapterTitle, meta, writeCtx);
    writeCtx.chapterPlan = planToXml(chapterPlan);

    while (!chapterAccepted && writeAttempt < MAX_REWRITES) {
      writeAttempt++;

      try {
        if (writeAttempt > 1) {
          console.log(`\n[重写] 第 ${writeAttempt} 次尝试：${chapterTitle}`);
          await cleanupForRewrite(this.novelDir, chapterNum);
        }

        // 执行写作 Agent
        const result = await runWriterAgent(writeCtx);

        if (!result.success || !result.content) {
          console.log("[自评] 未找到章节文件，跳过自评");
          chapterAccepted = true;
          break;
        }

        // 更新进度：草稿完成
        await this.state.updateChapterProgress(chapterNum, "draft_done");

        // HITL：用户审阅
        console.log(`\n── [${chapterTitle} 正文] ${"─".repeat(20)}`);
        console.log(result.content);
        console.log("─".repeat(50));

        const userReview = await askLine("审阅章节：(y=通过并自评 / s=直接通过跳过自评 / 输入修改意见重写) ");

        if (userReview.toLowerCase() === "s") {
          chapterAccepted = true;
          console.log("[审阅] 用户直接通过，跳过自评");
          await this.state.updateChapterProgress(chapterNum, "complete");
          break;
        } else if (userReview.toLowerCase() !== "y") {
          await appendPreference(userReview, `章节审阅 - ${chapterTitle}`);
          console.log("[审阅] 根据用户反馈重写...（反馈已沉淀）");
          writeCtx.meta = {
            ...writeCtx.meta,
            transition_notes: (writeCtx.meta.transition_notes ?? "") + `；用户修改意见：${userReview}`,
          };
          await this.state.updateStats({ totalRewrites: (this.state.data.stats.totalRewrites + 1) });
          await this.state.recordChapterAttempt(chapterNum);
          continue;
        }

        // 验证和自评
        const verifyResult = await verifyAgainstPlan(result.content, chapterPlan, meta);
        console.log(`\n[验证] ${verifyResult.summary}`);

        console.log(`[自评] 正在评审 ${chapterTitle}...`);
        const review = await reviewChapter(this.novelTitle, chapterTitle, result.content, meta, this.styleGuide);

        console.log(`[自评] 评分：${review.score}/5 — ${review.feedback}`);
        if (review.weak_sections.length > 0) {
          console.log(`[自评] 薄弱点：${review.weak_sections.join("；")}`);
        }

        // 更新进度：审阅完成
        await this.state.updateChapterProgress(chapterNum, "reviewed");
        await this.state.recordChapterScore(chapterNum, review.score);

        if (review.score >= REVIEW_THRESHOLD) {
          chapterAccepted = true;
          await this.state.updateChapterProgress(chapterNum, "complete");
          console.log(`✅ ${chapterTitle} 通过自评（${review.score}/5）`);
        } else {
          const rewriteChoice = await askLine(`评分较低（${review.score}/5），是否重写？(y/n) `);
          if (rewriteChoice.toLowerCase() === "y") {
            await this.state.recordChapterAttempt(chapterNum);
            continue;
          } else {
            chapterAccepted = true;
            await this.state.updateChapterProgress(chapterNum, "complete");
          }
        }

      } catch (error) {
        console.error(`\n❌ 第 ${chapterNum} 章生成失败:`, error);
        await this.state.recordChapterAttempt(chapterNum, String(error));

        if (writeAttempt >= MAX_REWRITES) {
          console.error(`第 ${chapterNum} 章已重试 ${MAX_REWRITES} 次，跳过`);
          const answer = await askLine("是否继续尝试？(y/n) ");
          if (answer === "y") {
            writeAttempt = 0;
            continue;
          }
          throw error;
        }

        const answer = await askLine("是否重试？(y/n) ");
        if (answer === "y") {
          continue;
        } else {
          throw error;
        }
      }
    }

    if (!chapterAccepted) {
      console.log(`\n⚠️  ${chapterTitle} 未通过（已达最大重写次数）`);
    }
  }

  private async reviewAndRewrite(chapterNum: number): Promise<void> {
    const files = await fs.readdir(this.novelDir);
    const chapterFile = files.find(f => f.startsWith(String(chapterNum).padStart(3, "0")));

    if (!chapterFile) {
      console.error(`第 ${chapterNum} 章文件不存在`);
      return;
    }

    const content = await fs.readFile(path.join(this.novelDir, chapterFile), "utf-8");
    const chapters = (await loadChapters(this.novelDir)) ?? [];
    const meta = chapters[chapterNum - 1];

    const review = await reviewChapter(this.novelTitle, meta.title, content, meta, this.styleGuide);
    console.log(`[审阅] 评分：${review.score}/5 — ${review.feedback}`);

    await this.state.recordChapterScore(chapterNum, review.score);
    await this.state.updateChapterProgress(chapterNum, "reviewed");

    const answer = await askLine("是否接受当前版本？(y/n) ");
    if (answer === "y") {
      await this.state.updateChapterProgress(chapterNum, "complete");
    } else {
      await this.writeAndVerifyChapter(chapterNum);
    }
  }

  // ── 构建写作上下文（精准注入）──────────────────────────

  private async buildWriteContext(
    chapterNum: number,
    chapterTitle: string,
    meta: ChapterMeta,
    allChapters: ChapterMeta[],
    detected: DetectedFiles,
    voiceProfiles: string,
    todo: TodoList,
    todoFilepath: string,
  ): Promise<WriteContext> {
    // 故事记忆
    const storySoFar = await fs.readFile(path.join(this.novelDir, "_story_so_far.md"), "utf-8").catch(() => "");

    // 上一章结尾 2000 字
    const prevNum = chapterNum - 1;
    let lastChapterEnding = "";
    let lastHandoff = "";
    if (prevNum >= 1) {
      const prevFiles = await fs.readdir(this.novelDir).catch((): string[] => []);
      const prevFile = prevFiles.find((f) => f.startsWith(String(prevNum).padStart(3, "0")));
      if (prevFile) {
        const raw = await fs.readFile(path.join(this.novelDir, prevFile), "utf-8").catch(() => "");
        lastChapterEnding = raw.slice(-2000);
      }
      const handoffFile = path.join(this.novelDir, `_handoff_${String(prevNum).padStart(3, "0")}.md`);
      lastHandoff = await fs.readFile(handoffFile, "utf-8").catch(() => "");
    }

    // 规划文件
    const outline = await fs.readFile(path.join(this.novelDir, "_outline.md"), "utf-8").catch(() => "");
    const characters = await fs.readFile(path.join(this.novelDir, "_characters.md"), "utf-8").catch(() => "");
    const relationships = await fs.readFile(path.join(this.novelDir, "_relationships.md"), "utf-8").catch(() => "");

    // 伏笔状态
    const foreshadowingRaw = await fs.readFile(path.join(this.novelDir, "_foreshadowing.json"), "utf-8").catch(() => "[]");
    const foreshadowing = JSON.parse(foreshadowingRaw) as Array<{
      desc: string; planted_at: string; status: string; expected_resolution: string;
    }>;

    // 情绪曲线
    const moodEntries = allChapters.map((c, i) => {
      const num = i + 1;
      const isDone = detected.existingChapterNums.includes(num);
      const isCurrent = num === chapterNum;
      const marker = isCurrent ? ">>> " : isDone ? "  * " : "    ";
      return `${marker}第${num}章 [${c.mood || "未定"}] ${c.title}`;
    });

    return {
      novelTitle: this.novelTitle,
      novelDir: this.novelDir,
      styleGuide: this.styleGuide,
      chapterNum,
      chapterTitle,
      meta,
      outline,
      characters,
      relationships,
      chapterPlan: "", // 由 planChapter 填充
      storySoFar,
      lastChapterEnding,
      lastHandoff,
      foreshadowing,
      voiceProfiles,
      moodEntries,
      todo,
      todoFilepath,
      compactOptions: this.compactOptions,
      onTool: this.onTool,
    };
  }

  // ── 辅助方法 ──────────────────────────────────────────────

  private async cleanupDrafts(): Promise<void> {
    const allFiles = await fs.readdir(this.novelDir).catch((): string[] => []);
    const drafts = allFiles.filter((f) => f.endsWith(".draft.md"));
    for (const draft of drafts) {
      const finalName = draft.replace(".draft.md", ".md");
      if (allFiles.includes(finalName)) {
        await fs.unlink(path.join(this.novelDir, draft)).catch(() => null);
        console.log(`[清理] 删除孤立草稿：${draft}`);
      }
    }
  }

  private async initTodoList(
    todoFilepath: string,
    chapters: ChapterMeta[],
    detected: DetectedFiles,
  ): Promise<{ todo: TodoList; pending: Array<{ id: number; task: string }> }> {
    const chapterTitles = chapters.map((c) => c.title);
    let todo = await TodoList.load(todoFilepath);

    const skipChaptersRaw = await fs.readFile(
      path.join(this.novelDir, "_skip_chapters.json"), "utf-8",
    ).catch(() => "[]");
    const skipNums: number[] = JSON.parse(skipChaptersRaw);

    if (todo) {
      todo.addIfAbsent(chapterTitles);
      console.log("\n[续写] 从 _todo.json 恢复任务状态");
    } else {
      todo = new TodoList();
      todo.add(chapterTitles);
      for (const item of todo.pending()) {
        if (detected.existingChapterNums.includes(item.id)) todo.update(item.id, "done");
      }
      await todo.save(todoFilepath);
    }

    if (skipNums.length > 0) {
      for (const item of todo.pending()) {
        if (skipNums.includes(item.id)) {
          todo.update(item.id, "done");
          console.log(`[跳过] 第 ${item.id} 章：${item.task}`);
        }
      }
      await todo.save(todoFilepath);
    }

    return { todo, pending: todo.pending() };
  }

  private printMoodCurve(
    chapters: ChapterMeta[],
    currentNum: number,
    existingNums: number[],
  ): void {
    const moodCurve = chapters.map((c, i) => {
      const num = i + 1;
      const isDone = existingNums.includes(num);
      const isCurrent = num === currentNum;
      const marker = isCurrent ? ">>>" : isDone ? " * " : "   ";
      return `${marker} 第${num}章 ${c.mood || "未定"}`;
    }).join("\n");
    console.log(`\n── 情绪曲线 ──\n${moodCurve}\n──────────────`);
  }

  private printAnalysisResult(result: AnalysisResult, detected: DetectedFiles): void {
    console.log("\n── [全文分析结果] ────────────────────────────────────");
    if (!detected.hasStorySoFar) {
      console.log("\n【故事摘要】");
      console.log(result.storySoFar);
    }
    console.log("\n【断点分析】");
    console.log(result.breakpointAnalysis);
    console.log("\n【识别到的伏笔】");
    result.foreshadowing.forEach((f, i) => {
      console.log(`  ${i + 1}. [${f.status}] ${f.desc}（${f.planted_at} → ${f.expected_resolution}）`);
    });
    console.log("─".repeat(50));
  }

  private async writeAnalysisFiles(result: AnalysisResult, detected: DetectedFiles): Promise<void> {
    if (!detected.hasStorySoFar && result.storySoFar) {
      await fs.writeFile(path.join(this.novelDir, "_story_so_far.md"), result.storySoFar, "utf-8");
      console.log("[分析] 已写入 _story_so_far.md");
    }

    if (!detected.chaptersHaveMetadata && result.chaptersWithMetadata?.length > 0) {
      await fs.writeFile(
        path.join(this.novelDir, "_chapters.json"),
        JSON.stringify(result.chaptersWithMetadata, null, 2),
        "utf-8",
      );
      console.log("[分析] 已更新 _chapters.json（含元数据）");
    }

    if (result.foreshadowing?.length > 0) {
      await fs.writeFile(
        path.join(this.novelDir, "_foreshadowing.json"),
        JSON.stringify(result.foreshadowing, null, 2),
        "utf-8",
      );
      console.log("[分析] 已写入 _foreshadowing.json");
    }
  }

  private async handleMissingChapters(detected: DetectedFiles): Promise<void> {
    const chapters = (await loadChapters(this.novelDir)) ?? [];
    const writtenNums = detected.existingChapterNums.slice().sort((a, b) => a - b);
    const totalChapters = chapters.length;
    const missingNums = Array.from({ length: totalChapters }, (_, i) => i + 1)
      .filter((n) => !writtenNums.includes(n));

    if (missingNums.length === 0) return;

    console.log(`\n── 检测到缺失章节：第 ${missingNums.join("、")} 章 ──`);
    console.log("  1. 补写缺失章节（按大纲正向写）");
    console.log("  2. 跳过，直接从当前断点续写");
    console.log("  3. 将缺失章节标记为番外，不影响主线");
    const choice = await askLine("请选择处理方式 (1/2/3)：");

    if (choice === "1") {
      console.log("[分析] 缺失章节将在写作阶段按顺序补写");
      await this.state.addDecision("analysis", "缺失章节处理", "补写");
    } else {
      await fs.writeFile(
        path.join(this.novelDir, "_skip_chapters.json"),
        JSON.stringify(missingNums),
        "utf-8",
      );
      const label = choice === "2" ? "跳过" : "标记番外";
      console.log(`[分析] 缺失章节已${label}`);
      await this.state.addDecision("analysis", "缺失章节处理", label);
    }
  }

  // ── 骨架模式：只生成框架 ──────────────────────────────────

  private async runSkeletonMode(): Promise<void> {
    console.log("\n── 骨架模式：快速生成框架 ──────────────────────────────");

    const detected = await detectFiles(this.novelDir);
    const premise = await fs.readFile(path.join(this.novelDir, "_premise.md"), "utf-8").catch(() => "");
    if (premise) console.log("[前提] 已加载 _premise.md");

    const existingContext = "";  // 骨架模式不需要已有章节

    // 1. 生成大纲
    if (!detected.hasOutline) {
      console.log("\n[1/4] 生成故事大纲...");
      await hitlGate(
        "故事大纲",
        async () => await fs.readFile(path.join(this.novelDir, "_outline.md"), "utf-8"),
        async (feedback) => {
          await runPlanAgent("outline", {
            novelTitle: this.novelTitle,
            novelDir: this.novelDir,
            styleGuide: this.styleGuide,
            existingContext,
            premise: premise || undefined,
            feedback,
            compactOptions: this.compactOptions,
            onTool: this.onTool,
          });
        }
      );
      await this.state.markPlanningDone("outline");
    } else {
      console.log("[1/4] 大纲已存在，跳过");
    }

    // 2. 生成人物
    if (!detected.hasCharacters) {
      console.log("\n[2/4] 生成人物设定...");
      await hitlGate(
        "人物设定",
        async () => await fs.readFile(path.join(this.novelDir, "_characters.md"), "utf-8"),
        async (feedback) => {
          await runPlanAgent("characters", {
            novelTitle: this.novelTitle,
            novelDir: this.novelDir,
            styleGuide: this.styleGuide,
            existingContext,
            premise: premise || undefined,
            feedback,
            compactOptions: this.compactOptions,
            onTool: this.onTool,
          });
        }
      );
      await this.state.markPlanningDone("characters");
    } else {
      console.log("[2/4] 人物设定已存在，跳过");
    }

    // 3. 生成关系
    if (!detected.hasRelationships) {
      console.log("\n[3/4] 生成人物关系...");
      await hitlGate(
        "人物关系",
        async () => await fs.readFile(path.join(this.novelDir, "_relationships.md"), "utf-8"),
        async (feedback) => {
          await runPlanAgent("relationships", {
            novelTitle: this.novelTitle,
            novelDir: this.novelDir,
            styleGuide: this.styleGuide,
            existingContext,
            premise: premise || undefined,
            feedback,
            compactOptions: this.compactOptions,
            onTool: this.onTool,
          });
        }
      );
      await this.state.markPlanningDone("relationships");
    } else {
      console.log("[3/4] 人物关系已存在，跳过");
    }

    // 4. 生成简化版章节列表（只有 title + target_words + mood）
    if (!detected.hasChapters) {
      console.log("\n[4/4] 生成章节列表（简化版）...");
      await hitlGate(
        "章节列表",
        async () => {
          const raw = await fs.readFile(path.join(this.novelDir, "_chapters.json"), "utf-8").catch(() => "");
          if (!raw) return "";
          const chapters = JSON.parse(raw) as ChapterMeta[];
          return chapters.map((c, i) => `${i + 1}. ${c.title} (${c.target_words ?? 2000}字, ${c.mood ?? "未指定"})`).join("\n");
        },
        async (feedback) => {
          await runChapterProposalAgent({
            novelTitle: this.novelTitle,
            novelDir: this.novelDir,
            styleGuide: this.styleGuide,
            existingContext,
            premise: premise || undefined,
            feedback,
            compactOptions: this.compactOptions,
            onTool: this.onTool,
          });
        }
      );
      await this.state.markPlanningDone("chapters");
    } else {
      console.log("[4/4] 章节列表已存在，跳过");
    }

    console.log("\n✅ 骨架生成完成！");
    console.log("\n下一步：");
    console.log("  - 检查生成的框架文件（_outline.md, _characters.md, _relationships.md, _chapters.json）");
    console.log("  - 满意后，使用 --mode full 开始完整写作流程");
    console.log("  - 或使用 --mode chapter --chapter N 单独生成某一章");

    await this.state.setPhase("planning");
    await this.state.pauseSession(["框架已生成，等待用户确认后开始写作"]);
  }

  // ── 断点续传：从上次失败的地方继续 ──────────────────────

  private async resumeFromCheckpoint(progress: import("./novel-state.js").ChapterProgress): Promise<void> {
    const { chapterNum, status } = progress;

    console.log(`\n从第 ${chapterNum} 章继续（状态: ${status}）...`);

    switch (status) {
      case "pending":
        // 从头开始生成
        console.log("[续传] 从头生成章节");
        await this.writeAndVerifyChapter(chapterNum);
        break;

      case "summary_done":
        // 概要已完成，扩写全章（暂未实现，先按完整流程）
        console.log("[续传] 概要已完成，生成全章");
        await this.writeAndVerifyChapter(chapterNum);
        break;

      case "draft_done":
        // 草稿已完成，进入 review
        console.log("[续传] 草稿已完成，进入审阅");
        await this.reviewAndRewrite(chapterNum);
        break;

      case "reviewed":
        // review 已完成，等待用户确认
        console.log("[续传] 审阅已完成，等待最终确认");
        const answer = await askLine("是否接受当前版本？(y/n) ");
        if (answer === "y") {
          await this.state.updateChapterProgress(chapterNum, "complete");
          console.log(`✅ 第 ${chapterNum} 章已完成`);
        } else {
          await this.writeAndVerifyChapter(chapterNum);
        }
        break;
    }

    // 继续后续章节
    const nextUnfinished = this.state.getUnfinishedChapters();
    if (nextUnfinished.length > 0) {
      const answer = await askLine(`继续下一章（第 ${nextUnfinished[0].chapterNum} 章）？(y/n) `);
      if (answer === "y") {
        await this.resumeFromCheckpoint(nextUnfinished[0]);
      }
    }
  }
}
