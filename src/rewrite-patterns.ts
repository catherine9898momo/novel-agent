/**
 * rewrite-patterns.ts - 重写模式学习（GSD 预防性修复模式）
 *
 * 分析历史评分，检测哪些维度在连续 N 章低分，
 * 生成预防性指令注入 writer system prompt，防患于未然。
 */

import type { DimensionScore } from "./agents/reviewer.js";
import type { ChapterScore } from "./novel-state.js";

// ── 类型定义 ──────────────────────────────────────────────

export interface RewritePattern {
  dimension: keyof DimensionScore;
  label: string;            // 中文标签
  frequency: number;        // 低分章节数
  chapters: number[];       // 哪些章节低分
  avgScore: number;         // 该维度平均分
}

export interface RewriteRecord {
  chapter: number;
  attempt: number;
  fromScore: number;
  toScore: number;
  dimensions?: DimensionScore;
  issues: string[];         // 从 weak_spots 提取的 issue 类型
}

// ── 维度标签映射 ─────────────────────────────────────────

const DIM_LABELS: Record<keyof DimensionScore, string> = {
  plot_advancement: "情节推进",
  character_voice:  "人物声音一致性",
  prose_quality:    "文笔质量",
  emotional_arc:    "情感弧线",
  pacing:           "节奏把控",
};

// ── 预防性指令模板 ────────────────────────────────────────

export const DIM_INSTRUCTIONS: Record<keyof DimensionScore, string> = {
  plot_advancement:
    "情节推进方面：确保每场戏都有一个微小的转折或信息增量，禁止原地踏步的闲笔。每段对话结束后，人物关系或局面必须有所变化。",
  character_voice:
    "人物声音方面：严格区分各角色的语言习惯——主角内敛克制，惯用短句和反问；配角可活泼，但不得越俎代庖抢夺主角的情绪重心。写对话前先在脑中模拟该角色的声线和措辞习惯。",
  prose_quality:
    "文笔质量方面：避免'她心想''他感到'等直白心理陈述，改用动作、细节、环境折射内心。辞藻不堆砌，每个形容词都要做事。句式长短交错，避免连续同等长度的句子。",
  emotional_arc:
    "情感弧线方面：情绪要有起伏，禁止一路平铺。克制不等于删除情感，而是把情感藏进细节——手指微微收紧、视线刻意回避、沉默本身就是回答。章节结尾情绪需比开头有所推进或反转。",
  pacing:
    "节奏把控方面：高张力场景用短句、短段落加速；温情/回忆场景允许长句舒展。场景切换前必须有情绪或环境的过渡句，禁止硬切。对话密集处适当插入人物动作或环境描写作为呼吸点。",
};

// ── 核心分析函数 ──────────────────────────────────────────

/**
 * 扫描历史评分，找出连续低分（< threshold）出现 minChapters 次以上的维度
 */
export function analyzePatterns(
  scores: Record<number, ChapterScore>,
  threshold = 3,
  minChapters = 3,
): RewritePattern[] {
  const dimKeys = Object.keys(DIM_LABELS) as (keyof DimensionScore)[];
  const patterns: RewritePattern[] = [];

  for (const dim of dimKeys) {
    const lowChapters: number[] = [];
    let total = 0;
    let count = 0;

    for (const [ch, entry] of Object.entries(scores)) {
      if (typeof entry === "object" && entry.dimensions) {
        const val = entry.dimensions[dim];
        total += val;
        count++;
        if (val < threshold) {
          lowChapters.push(Number(ch));
        }
      }
    }

    if (lowChapters.length >= minChapters) {
      patterns.push({
        dimension: dim,
        label: DIM_LABELS[dim],
        frequency: lowChapters.length,
        chapters: lowChapters.sort((a, b) => a - b),
        avgScore: count > 0 ? Math.round((total / count) * 10) / 10 : 0,
      });
    }
  }

  // 按频率降序，问题最严重的排前面
  return patterns.sort((a, b) => b.frequency - a.frequency);
}

/**
 * 将检测到的模式转成可注入 writer system prompt 的文字指令
 * 若无模式则返回空字符串
 */
export function generatePreemptiveInstruction(patterns: RewritePattern[]): string {
  if (patterns.length === 0) return "";

  const lines: string[] = [
    "## ⚠️ 历史章节质量预警（请重点关注以下方面）",
    "",
    `根据前 ${Math.max(...patterns.flatMap(p => p.chapters))} 章的评审数据，以下维度持续低分，本章写作时必须针对性改进：`,
    "",
  ];

  for (const p of patterns) {
    lines.push(
      `### ${p.label}（${p.frequency} 章低分，均分 ${p.avgScore}/5，问题章节：第 ${p.chapters.join("、")} 章）`,
      DIM_INSTRUCTIONS[p.dimension],
      "",
    );
  }

  return lines.join("\n");
}
