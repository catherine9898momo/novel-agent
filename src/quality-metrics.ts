/**
 * quality-metrics.ts - 自动质量指标（非 LLM，纯文本分析）
 *
 * 在 LLM 评审前运行，检测机械可测的问题并注入评审上下文。
 *
 * 指标列表：
 *   - dialogueRatio       对话占比（目标 0.3-0.6）
 *   - avgSentenceLength   平均句长（字符数）
 *   - sentenceLengthCV    句长变异系数（低 = 节奏单调）
 *   - repeatedPhrases     重复短语（3+ 次出现的 4+ 字短语）
 *   - paragraphLengthCV   段落长度变异系数（低 = 结构单调）
 *   - exclamationDensity  感叹号密度（每百字感叹号数）
 *   - adverbDensity       副词密度（"地"字结构，每百字出现次数）
 */

// ── 类型定义 ──────────────────────────────────────────────

export interface QualityMetrics {
  dialogueRatio: number;         // 对话字数 / 总字数
  avgSentenceLength: number;     // 平均句长（字符）
  sentenceLengthCV: number;      // 句长变异系数（std / mean），低 = 单调
  repeatedPhrases: string[];     // 出现 3+ 次的 4+ 字短语
  paragraphLengthCV: number;     // 段落长度变异系数
  exclamationDensity: number;    // 每百字感叹号数
  adverbDensity: number;         // 每百字"地"字副词修饰数
}

export interface MetricAnomaly {
  metric: keyof QualityMetrics;
  value: number | string[];
  message: string;
}

// ── 辅助函数 ──────────────────────────────────────────────

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

function coefficientOfVariation(arr: number[]): number {
  const m = mean(arr);
  if (m === 0) return 0;
  return Math.round((stdDev(arr) / m) * 100) / 100;
}

// ── 各指标计算 ────────────────────────────────────────────

/**
 * 对话占比：统计引号内（「」""）的字符数 / 总字符数
 */
function computeDialogueRatio(text: string): number {
  const total = text.replace(/\s/g, "").length;
  if (total === 0) return 0;

  let dialogueChars = 0;
  // 匹配「...」和"..."（中文书名号对话）
  const dialoguePattern = /[「"]([\s\S]*?)[」"]/g;
  let m: RegExpExecArray | null;
  while ((m = dialoguePattern.exec(text)) !== null) {
    dialogueChars += m[1].replace(/\s/g, "").length;
  }
  return Math.round((dialogueChars / total) * 100) / 100;
}

/**
 * 句长分析：按句末标点（。！？…）分句
 */
function getSentenceLengths(text: string): number[] {
  const sentences = text
    .split(/[。！？…]+/)
    .map(s => s.replace(/\s/g, "").length)
    .filter(l => l > 3);
  return sentences;
}

/**
 * 重复短语检测：提取所有 4-8 字的子串，找出出现 3+ 次的
 * 排除纯标点和数字串
 */
function findRepeatedPhrases(text: string, minLen = 4, maxLen = 8, minCount = 3): string[] {
  const clean = text.replace(/\s/g, "");
  const counts = new Map<string, number>();

  for (let i = 0; i < clean.length; i++) {
    for (let len = minLen; len <= maxLen && i + len <= clean.length; len++) {
      const phrase = clean.slice(i, i + len);
      // 跳过含标点超过 50% 的短语
      const punctCount = (phrase.match(/[，。！？、：；""「」…—\s]/g) ?? []).length;
      if (punctCount > phrase.length * 0.5) continue;
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
    }
  }

  const repeated: string[] = [];
  for (const [phrase, count] of counts) {
    if (count >= minCount) repeated.push(phrase);
  }

  // 去除被更长短语覆盖的子串（只保留最长的重复单元）
  return repeated
    .filter(p => !repeated.some(other => other !== p && other.includes(p) && other.length > p.length))
    .sort((a, b) => b.length - a.length)
    .slice(0, 10); // 最多报告 10 条
}

/**
 * 段落长度变异系数
 */
function computeParagraphLengthCV(text: string): number {
  const lengths = text
    .split(/\n+/)
    .map(p => p.replace(/\s/g, "").length)
    .filter(l => l > 10);
  return coefficientOfVariation(lengths);
}

/**
 * 感叹号密度（每百字）
 */
function computeExclamationDensity(text: string): number {
  const total = text.replace(/\s/g, "").length;
  if (total === 0) return 0;
  const count = (text.match(/[！!]/g) ?? []).length;
  return Math.round((count / total) * 100 * 100) / 100;
}

/**
 * 副词密度：匹配"X地"结构（2-4 字修饰词 + 地）每百字出现次数
 * 这是古言小说中滥用副词的典型模式
 */
function computeAdverbDensity(text: string): number {
  const total = text.replace(/\s/g, "").length;
  if (total === 0) return 0;
  const count = (text.match(/[\u4e00-\u9fa5]{2,4}地(?![\u9053\u65b9\u5730\u5c71])/g) ?? []).length;
  return Math.round((count / total) * 100 * 100) / 100;
}

// ── 主入口 ────────────────────────────────────────────────

export function computeMetrics(chapter: string): QualityMetrics {
  const sentLengths = getSentenceLengths(chapter);
  return {
    dialogueRatio:      computeDialogueRatio(chapter),
    avgSentenceLength:  Math.round(mean(sentLengths)),
    sentenceLengthCV:   coefficientOfVariation(sentLengths),
    repeatedPhrases:    findRepeatedPhrases(chapter),
    paragraphLengthCV:  computeParagraphLengthCV(chapter),
    exclamationDensity: computeExclamationDensity(chapter),
    adverbDensity:      computeAdverbDensity(chapter),
  };
}

/**
 * 将指标异常转成可读的警告文字，供注入 reviewer 上下文。
 * 只报告超出阈值的项，无异常返回空字符串。
 */
export function flagAnomalies(metrics: QualityMetrics): MetricAnomaly[] {
  const anomalies: MetricAnomaly[] = [];

  if (metrics.dialogueRatio < 0.10) {
    anomalies.push({
      metric: "dialogueRatio",
      value: metrics.dialogueRatio,
      message: `对话占比过低（${(metrics.dialogueRatio * 100).toFixed(1)}%，建议 30-60%），叙述可能过于沉闷`,
    });
  } else if (metrics.dialogueRatio > 0.65) {
    anomalies.push({
      metric: "dialogueRatio",
      value: metrics.dialogueRatio,
      message: `对话占比过高（${(metrics.dialogueRatio * 100).toFixed(1)}%，建议 30-60%），缺乏叙述与描写`,
    });
  }

  if (metrics.sentenceLengthCV < 0.3 && metrics.avgSentenceLength > 0) {
    anomalies.push({
      metric: "sentenceLengthCV",
      value: metrics.sentenceLengthCV,
      message: `句长变化过少（CV=${metrics.sentenceLengthCV}），节奏单调，建议长短句交错`,
    });
  }

  if (metrics.repeatedPhrases.length > 0) {
    anomalies.push({
      metric: "repeatedPhrases",
      value: metrics.repeatedPhrases,
      message: `检测到重复短语（${metrics.repeatedPhrases.slice(0, 5).map(p => `「${p}」`).join("、")}），需检查是否有冗余描写`,
    });
  }

  if (metrics.paragraphLengthCV < 0.25) {
    anomalies.push({
      metric: "paragraphLengthCV",
      value: metrics.paragraphLengthCV,
      message: `段落长度过于均匀（CV=${metrics.paragraphLengthCV}），版式单调，建议长短段落交错`,
    });
  }

  if (metrics.exclamationDensity > 1.5) {
    anomalies.push({
      metric: "exclamationDensity",
      value: metrics.exclamationDensity,
      message: `感叹号密度偏高（每百字 ${metrics.exclamationDensity} 个），情绪外露，建议克制`,
    });
  }

  if (metrics.adverbDensity > 2.0) {
    anomalies.push({
      metric: "adverbDensity",
      value: metrics.adverbDensity,
      message: `副词（"XX地"）密度偏高（每百字 ${metrics.adverbDensity} 个），建议改用动作和细节替代`,
    });
  }

  return anomalies;
}

/**
 * 将异常列表格式化为可注入 reviewer prompt 的文字块
 */
export function formatAnomaliesForReviewer(anomalies: MetricAnomaly[]): string {
  if (anomalies.length === 0) return "";
  return [
    "## 自动质量检测结果（请在评审中重点关注）",
    "",
    ...anomalies.map(a => `- ${a.message}`),
    "",
  ].join("\n");
}
