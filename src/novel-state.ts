/**
 * novel-state.ts - 会话状态管理（GSD STATE.md 模式）
 *
 * 核心理念：重要状态存文件，不依赖对话历史
 *
 * STATE.md 是每部小说的"记忆中枢"，跨会话持久化：
 *   - 当前阶段和进度
 *   - 用户决策记录
 *   - 待解决问题
 *   - 会话交接信息（pause/resume）
 *   - 写作统计
 */

import fs from "fs/promises";
import path from "path";
import type { DimensionScore } from "./agents/reviewer.js";
import type { RewriteRecord } from "./rewrite-patterns.js";

// ── 类型定义 ──────────────────────────────────────────────

export type WorkflowPhase =
  | "init"         // 初始化
  | "planning"     // 规划阶段（大纲、人物、关系、章节列表）
  | "analysis"     // 全文分析（逆向提取）
  | "writing"      // 写作阶段
  | "reviewing"    // 审阅/验证阶段
  | "complete";    // 完结

export interface Decision {
  timestamp: string;
  phase: WorkflowPhase;
  topic: string;       // 决策主题
  choice: string;      // 用户选择
  context?: string;    // 上下文
}

export interface SessionRecord {
  startedAt: string;
  endedAt?: string;
  phase: WorkflowPhase;
  accomplishments: string[];
  nextSteps: string[];
}

export type ChapterScore =
  | number
  | { overall: number; dimensions: DimensionScore };

export interface WritingStats {
  totalWords: number;
  chaptersCompleted: number;
  chaptersTotal: number;
  averageScore: number;
  totalRewrites: number;
  scores: Record<number, ChapterScore>;   // chapterNum -> score
}

export interface ChapterProgress {
  chapterNum: number;
  status: "pending" | "summary_done" | "draft_done" | "reviewed" | "complete";
  summaryPath?: string;
  draftPath?: string;
  lastCheckpoint?: string;  // checkpoint 文件路径
  attempts: number;         // 重试次数
  lastError?: string;
}

export interface NovelSessionState {
  novelTitle: string;
  style: string;
  currentPhase: WorkflowPhase;
  currentChapter: number | null;

  // 规划完成度
  planningComplete: {
    outline: boolean;
    characters: boolean;
    relationships: boolean;
    chapters: boolean;
  };

  // 用户决策记录（GSD CONTEXT.md 模式）
  decisions: Decision[];

  // 待解决问题
  openQuestions: string[];

  // 会话记录
  sessions: SessionRecord[];
  currentSession: SessionRecord | null;

  // 写作统计
  stats: WritingStats;

  // 章节进度（断点续传）
  chapterProgress: Record<number, ChapterProgress>;

  // 重写历史（模式学习用）
  rewriteHistory: RewriteRecord[];
}

// ── 默认状态 ──────────────────────────────────────────────

function createDefaultState(novelTitle: string, style: string): NovelSessionState {
  return {
    novelTitle,
    style,
    currentPhase: "init",
    currentChapter: null,
    planningComplete: {
      outline: false,
      characters: false,
      relationships: false,
      chapters: false,
    },
    decisions: [],
    openQuestions: [],
    sessions: [],
    currentSession: null,
    stats: {
      totalWords: 0,
      chaptersCompleted: 0,
      chaptersTotal: 0,
      averageScore: 0,
      totalRewrites: 0,
      scores: {},
    },
    chapterProgress: {},
    rewriteHistory: [],
  };
}

// ── 状态管理类 ──────────────────────────────────────────────

export class NovelState {
  private state: NovelSessionState;
  private statePath: string;   // _state.json
  private mdPath: string;      // STATE.md（人类可读）

  private constructor(state: NovelSessionState, novelDir: string) {
    this.state = state;
    this.statePath = path.join(novelDir, "_state.json");
    this.mdPath = path.join(novelDir, "STATE.md");
  }

  // ── 工厂方法 ────────────────────────────────────────────

  static async load(novelDir: string, novelTitle: string, style: string): Promise<NovelState> {
    const statePath = path.join(novelDir, "_state.json");
    const raw = await fs.readFile(statePath, "utf-8").catch(() => null);

    if (raw) {
      const parsed = JSON.parse(raw) as NovelSessionState;
      return new NovelState(parsed, novelDir);
    }

    const state = createDefaultState(novelTitle, style);
    const instance = new NovelState(state, novelDir);
    await instance.save();
    return instance;
  }

  // ── 读取 ────────────────────────────────────────────────

  get data(): Readonly<NovelSessionState> {
    return this.state;
  }

  get phase(): WorkflowPhase {
    return this.state.currentPhase;
  }

  get chapter(): number | null {
    return this.state.currentChapter;
  }

  // ── 阶段管理 ────────────────────────────────────────────

  async setPhase(phase: WorkflowPhase): Promise<void> {
    this.state.currentPhase = phase;
    await this.save();
  }

  async setCurrentChapter(num: number | null): Promise<void> {
    this.state.currentChapter = num;
    await this.save();
  }

  async markPlanningDone(type: keyof NovelSessionState["planningComplete"]): Promise<void> {
    this.state.planningComplete[type] = true;
    await this.save();
  }

  // ── 决策记录（GSD CONTEXT.md 模式）────────────────────

  async addDecision(phase: WorkflowPhase, topic: string, choice: string, context?: string): Promise<void> {
    this.state.decisions.push({
      timestamp: new Date().toISOString(),
      phase,
      topic,
      choice,
      context,
    });
    await this.save();
  }

  getDecisions(phase?: WorkflowPhase): Decision[] {
    if (phase) return this.state.decisions.filter((d) => d.phase === phase);
    return this.state.decisions;
  }

  // ── 章节进度管理（断点续传）──────────────────────────────

  async updateChapterProgress(
    chapterNum: number,
    status: ChapterProgress["status"],
    checkpointPath?: string
  ): Promise<void> {
    if (!this.state.chapterProgress[chapterNum]) {
      this.state.chapterProgress[chapterNum] = {
        chapterNum,
        status: "pending",
        attempts: 0
      };
    }

    this.state.chapterProgress[chapterNum].status = status;
    if (checkpointPath) {
      this.state.chapterProgress[chapterNum].lastCheckpoint = checkpointPath;
    }

    await this.save();
  }

  async recordChapterAttempt(chapterNum: number, error?: string): Promise<void> {
    if (!this.state.chapterProgress[chapterNum]) {
      this.state.chapterProgress[chapterNum] = {
        chapterNum,
        status: "pending",
        attempts: 0
      };
    }

    this.state.chapterProgress[chapterNum].attempts += 1;
    if (error) {
      this.state.chapterProgress[chapterNum].lastError = error;
    }

    await this.save();
  }

  getChapterProgress(chapterNum: number): ChapterProgress | null {
    return this.state.chapterProgress[chapterNum] ?? null;
  }

  getUnfinishedChapters(): ChapterProgress[] {
    return Object.values(this.state.chapterProgress ?? {})
      .filter(p => p.status !== "complete")
      .sort((a, b) => a.chapterNum - b.chapterNum);
  }

  // ── 待解决问题 ──────────────────────────────────────────

  async addOpenQuestion(question: string): Promise<void> {
    this.state.openQuestions.push(question);
    await this.save();
  }

  async resolveQuestion(question: string): Promise<void> {
    this.state.openQuestions = this.state.openQuestions.filter((q) => q !== question);
    await this.save();
  }

  // ── 会话管理（GSD pause/resume 模式）───────────────────

  async startSession(): Promise<void> {
    this.state.currentSession = {
      startedAt: new Date().toISOString(),
      phase: this.state.currentPhase,
      accomplishments: [],
      nextSteps: [],
    };
    await this.save();
  }

  async addAccomplishment(text: string): Promise<void> {
    if (this.state.currentSession) {
      this.state.currentSession.accomplishments.push(text);
      await this.save();
    }
  }

  async pauseSession(nextSteps: string[]): Promise<void> {
    if (this.state.currentSession) {
      this.state.currentSession.endedAt = new Date().toISOString();
      this.state.currentSession.nextSteps = nextSteps;
      this.state.sessions.push(this.state.currentSession);
      this.state.currentSession = null;
      await this.save();
    }
  }

  getLastSession(): SessionRecord | null {
    return this.state.sessions.length > 0
      ? this.state.sessions[this.state.sessions.length - 1]
      : null;
  }

  // ── 写作统计 ──────────────────────────────────────────────

  async updateStats(update: Partial<WritingStats>): Promise<void> {
    Object.assign(this.state.stats, update);
    // 重算平均分
    const scores = Object.values(this.state.stats.scores)
      .map(s => typeof s === "number" ? s : s.overall);
    if (scores.length > 0) {
      this.state.stats.averageScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    }
    await this.save();
  }

  async recordRewrite(
    chapter: number,
    attempt: number,
    fromScore: number,
    toScore: number,
    issues: string[],
    dimensions?: DimensionScore,
  ): Promise<void> {
    if (!this.state.rewriteHistory) this.state.rewriteHistory = [];
    this.state.rewriteHistory.push({ chapter, attempt, fromScore, toScore, dimensions, issues });
    await this.save();
  }

  async recordChapterScore(chapterNum: number, score: number, dimensions?: DimensionScore): Promise<void> {
    this.state.stats.scores[chapterNum] = dimensions
      ? { overall: score, dimensions }
      : score;
    const scores = Object.values(this.state.stats.scores)
      .map(s => typeof s === "number" ? s : s.overall);
    this.state.stats.averageScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    await this.save();
  }

  // ── 持久化 ──────────────────────────────────────────────

  async save(): Promise<void> {
    // JSON（程序读取）
    await fs.writeFile(this.statePath, JSON.stringify(this.state, null, 2), "utf-8");
    // Markdown（人类可读 + LLM 注入用）
    await fs.writeFile(this.mdPath, this.toMarkdown(), "utf-8");
  }

  // ── Markdown 输出（注入 LLM prompt 用）────────────────

  toMarkdown(): string {
    const s = this.state;
    const lines: string[] = [
      `# STATE — 《${s.novelTitle}》`,
      "",
      `> 当前阶段: **${s.currentPhase}**${s.currentChapter ? ` | 当前章节: **第${s.currentChapter}章**` : ""}`,
      "",
    ];

    // 规划完成度
    const planItems = Object.entries(s.planningComplete)
      .map(([k, v]) => `  - ${v ? "✅" : "⬜"} ${k}`)
      .join("\n");
    lines.push("## 规划进度", planItems, "");

    // 写作统计
    if (s.stats.chaptersTotal > 0) {
      lines.push(
        "## 写作统计",
        `  - 进度: ${s.stats.chaptersCompleted}/${s.stats.chaptersTotal} 章`,
        `  - 总字数: ${s.stats.totalWords}`,
        `  - 平均评分: ${s.stats.averageScore.toFixed(1)}/5`,
        `  - 重写次数: ${s.stats.totalRewrites}`,
        "",
      );

      // 维度评分简报（仅当有维度数据时显示）
      const dimEntries = Object.entries(s.stats.scores)
        .filter((e): e is [string, { overall: number; dimensions: DimensionScore }] =>
          typeof e[1] === "object")
        .sort(([a], [b]) => Number(a) - Number(b));

      if (dimEntries.length > 0) {
        const dimLabels: Record<keyof DimensionScore, string> = {
          plot_advancement: "情节",
          character_voice: "声音",
          prose_quality: "文笔",
          emotional_arc: "情感",
          pacing: "节奏",
        };
        lines.push("## 章节维度评分");
        for (const [ch, entry] of dimEntries) {
          const d = entry.dimensions;
          const bar = (v: number) => "█".repeat(v) + "░".repeat(5 - v);
          lines.push(
            `  - 第${ch}章 (总:${entry.overall}) ` +
            (Object.keys(dimLabels) as (keyof DimensionScore)[])
              .map(k => `${dimLabels[k]}${bar(d[k])}`)
              .join(" "),
          );
        }
        lines.push("");
      }
    }

    // 用户决策
    if (s.decisions.length > 0) {
      lines.push("## 用户决策");
      for (const d of s.decisions.slice(-10)) { // 只显示最近 10 条
        lines.push(`  - **${d.topic}**: ${d.choice}${d.context ? ` _(${d.context})_` : ""}`);
      }
      lines.push("");
    }

    // 待解决问题
    if (s.openQuestions.length > 0) {
      lines.push("## 待解决问题");
      for (const q of s.openQuestions) {
        lines.push(`  - ❓ ${q}`);
      }
      lines.push("");
    }

    // 上次会话
    const last = this.getLastSession();
    if (last) {
      lines.push(
        "## 上次会话",
        `  - 时间: ${last.startedAt}${last.endedAt ? ` → ${last.endedAt}` : ""}`,
        `  - 阶段: ${last.phase}`,
      );
      if (last.accomplishments.length > 0) {
        lines.push("  - 完成:");
        for (const a of last.accomplishments) lines.push(`    - ${a}`);
      }
      if (last.nextSteps.length > 0) {
        lines.push("  - 下一步:");
        for (const n of last.nextSteps) lines.push(`    - ${n}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  // ── 精简版（注入写作 agent 的 system prompt，控制 token）──

  toCompactPrompt(): string {
    const s = this.state;
    const lines: string[] = [
      `<state phase="${s.currentPhase}"${s.currentChapter ? ` chapter="${s.currentChapter}"` : ""}>`,
    ];

    if (s.stats.chaptersTotal > 0) {
      lines.push(`  <progress>${s.stats.chaptersCompleted}/${s.stats.chaptersTotal} 章 | ${s.stats.totalWords} 字 | 均分 ${s.stats.averageScore.toFixed(1)}</progress>`);
    }

    // 只注入与当前阶段相关的决策
    const phaseDecisions = this.getDecisions(s.currentPhase);
    if (phaseDecisions.length > 0) {
      lines.push("  <decisions>");
      for (const d of phaseDecisions.slice(-5)) {
        lines.push(`    <decision topic="${d.topic}">${d.choice}</decision>`);
      }
      lines.push("  </decisions>");
    }

    if (s.openQuestions.length > 0) {
      lines.push("  <open_questions>");
      for (const q of s.openQuestions) lines.push(`    <q>${q}</q>`);
      lines.push("  </open_questions>");
    }

    lines.push("</state>");
    return lines.join("\n");
  }
}
