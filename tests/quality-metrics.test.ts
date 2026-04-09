/**
 * quality-metrics.test.ts - 自动质量指标单测
 */

import { describe, it, expect } from "vitest";
import { computeMetrics, flagAnomalies, formatAnomaliesForReviewer } from "../src/quality-metrics.js";

// ── 测试用章节文本 ─────────────────────────────────────────

const NORMAL_CHAPTER = `
沈清辞低垂着眸，指尖轻轻摩挲着袖口的暗纹。

「你来做什么。」他的声音平静，像是一汪死水，泛不起半点涟漪。

萧衍没有回答，只是站在原地，任由光线将他半张脸淹没在阴影里。

她终于抬起头，对上那双看不出情绪的眼睛，心跳漏了半拍。

「我来取东西。」他说，声线低沉，「顺道看看你。」

沉默拉得太长。她转过身，假装在整理桌上的文书，手指却微微用力，将一角纸压出了褶皱。

门外的风把窗纸吹得簌簌作响，廊下的灯火在风里摇晃，映出两个人的影子，一远一近，始终没有靠拢。

「东西在哪里，你自己找。」她说，语气比她预想中更冷。

他沉默了一下，「好。」

然后就真的开始找了。她不知道他在找什么，也不想知道。

窗外天色将暗未暗，最后一点暮光把他的轮廓镀成了金色。沈清辞克制地移开了目光，心想，这个人真是一点都没有变。
`.trim();

const DIALOGUE_HEAVY = `
「你怎么在这里！」她惊呼。
「我就是在这里。」他说。
「你不应该来的！」她道。
「为什么不应该？」他反问。
「因为……因为……」她语塞。
「因为什么？」他追问。
「算了，你爱来就来吧！」她叹气。
「那我就留下了。」他说。
「随便。」她应道。
「你真的不在意？」他问。
「在意又怎样？」她反问。
「那你在意。」他笑了。
`.trim();

const MONOTONE_SENTENCES = "沈清辞走进房间。她看见了萧衍。他正在看书。她停下脚步。他抬起头来。两人对视片刻。她转身离开。他没有挽留。".repeat(5);

const REPEATED_PHRASE_CHAPTER = "沈清辞心中一颤，不知所措。沈清辞心中一颤，慌忙回避。沈清辞心中一颤，低下了头。沈清辞心中一颤，说不出话来。".repeat(3);

// ── computeMetrics ────────────────────────────────────────

describe("computeMetrics", () => {
  it("正常章节：dialogueRatio 在合理范围", () => {
    const m = computeMetrics(NORMAL_CHAPTER);
    expect(m.dialogueRatio).toBeGreaterThan(0.05);
    expect(m.dialogueRatio).toBeLessThan(0.8);
  });

  it("对话密集章节：dialogueRatio 偏高", () => {
    const m = computeMetrics(DIALOGUE_HEAVY);
    expect(m.dialogueRatio).toBeGreaterThan(0.5);
  });

  it("句长变异系数：节奏单调文本 CV 偏低", () => {
    const m = computeMetrics(MONOTONE_SENTENCES);
    // 所有句子都很短且长度相近，CV 应偏低
    expect(m.sentenceLengthCV).toBeLessThan(0.5);
  });

  it("重复短语检测", () => {
    const m = computeMetrics(REPEATED_PHRASE_CHAPTER);
    expect(m.repeatedPhrases.length).toBeGreaterThan(0);
    // "心中一颤" 出现 12 次，应被检测到
    expect(m.repeatedPhrases.some(p => p.includes("心中一颤"))).toBe(true);
  });

  it("空文本不崩溃", () => {
    const m = computeMetrics("");
    expect(m.dialogueRatio).toBe(0);
    expect(m.avgSentenceLength).toBe(0);
    expect(m.repeatedPhrases).toHaveLength(0);
  });

  it("感叹号密度：感叹号多的文本 density 高", () => {
    const text = "她惊呼！他急道！真的吗！怎么会！不可能！天哪！";
    const m = computeMetrics(text);
    expect(m.exclamationDensity).toBeGreaterThan(1.5);
  });
});

// ── flagAnomalies ─────────────────────────────────────────

describe("flagAnomalies", () => {
  it("正常章节无感叹号过多和副词过多异常", () => {
    const m = computeMetrics(NORMAL_CHAPTER);
    const anomalies = flagAnomalies(m);
    // 正常古言叙事章节不应触发感叹号或副词密度告警
    expect(anomalies.filter(a => a.metric === "exclamationDensity")).toHaveLength(0);
    expect(anomalies.filter(a => a.metric === "adverbDensity")).toHaveLength(0);
  });

  it("对话过多触发 dialogueRatio 异常", () => {
    // 构造一个 dialogueRatio > 0.65 的文本
    const veryHeavy = "「说话说话说话说话说话。」他道。「继续说继续说继续说。」她应。".repeat(20);
    const m = computeMetrics(veryHeavy);
    const anomalies = flagAnomalies(m);
    expect(anomalies.some(a => a.metric === "dialogueRatio")).toBe(true);
  });

  it("重复短语触发 repeatedPhrases 异常", () => {
    const m = computeMetrics(REPEATED_PHRASE_CHAPTER);
    const anomalies = flagAnomalies(m);
    expect(anomalies.some(a => a.metric === "repeatedPhrases")).toBe(true);
  });

  it("节奏单调触发 sentenceLengthCV 异常", () => {
    const m = computeMetrics(MONOTONE_SENTENCES);
    const anomalies = flagAnomalies(m);
    expect(anomalies.some(a => a.metric === "sentenceLengthCV")).toBe(true);
  });

  it("副词密度：大量'地'字结构触发异常", () => {
    const adverbText = "他轻轻地走过来，缓缓地坐下，静静地看着她，温柔地开口道话，慢慢地靠近她，认真地审视着。".repeat(10);
    const m = computeMetrics(adverbText);
    const anomalies = flagAnomalies(m);
    expect(anomalies.some(a => a.metric === "adverbDensity")).toBe(true);
  });
});

// ── formatAnomaliesForReviewer ────────────────────────────

describe("formatAnomaliesForReviewer", () => {
  it("无异常时返回空字符串", () => {
    expect(formatAnomaliesForReviewer([])).toBe("");
  });

  it("有异常时包含标题和消息", () => {
    const m = computeMetrics(DIALOGUE_HEAVY);
    const anomalies = flagAnomalies(m);
    const formatted = formatAnomaliesForReviewer(anomalies);
    expect(formatted).toContain("自动质量检测结果");
    expect(formatted.length).toBeGreaterThan(10);
  });
});
