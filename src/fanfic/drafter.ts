import { endpoints, type ModelEndpoint } from "../models.js";
import type { FanficWriterContext } from "./writer-context.js";

export interface FanficDrafterOptions {
  endpoint?: ModelEndpoint;
}

export async function draftFanficShortStory(
  context: FanficWriterContext,
  options: FanficDrafterOptions = {},
): Promise<string> {
  const endpoint = options.endpoint ?? endpoints.fanficWrite;
  const response = await endpoint.client.messages.create({
    model: endpoint.model,
    max_tokens: estimateMaxTokens(context.targetWordCount),
    system: buildSystemPrompt(),
    messages: [{ role: "user", content: buildUserPrompt(context) }],
  });

  const draft = response.content
    .filter((block) => block.type === "text")
    .map((block) => (block as { type: "text"; text: string }).text)
    .join("")
    .trim();

  validateDraftContract(draft, context);
  return draft;
}

function estimateMaxTokens(targetWordCount: number): number {
  return Math.max(1200, Math.ceil(targetWordCount * 1.8));
}

function buildSystemPrompt(): string {
  return [
    "你是同人短篇小说 writer，只根据已确认的 writer context 写第一版草稿。",
    "不要改动设定，不要增加未确认 CP，不要解释你的写作过程。",
    "必须输出 Markdown 正文。",
  ].join("\n");
}

function buildUserPrompt(context: FanficWriterContext): string {
  return [
    "请根据以下 writer context 写第一版同人短篇草稿。",
    "",
    "最低要求：",
    "- 覆盖所有 requiredScenes，requiredScenes 中的每个原文短语尽量完整出现在正文里。",
    "- 字数至少达到 targetWordCount 的 60%。",
    "- 避免 avoidChecks 中的问题。",
    "- 按 plan.scenes 顺序推进，并体现核心 beats。",
    "",
    JSON.stringify(context, null, 2),
  ].join("\n");
}

function validateDraftContract(draft: string, context: FanficWriterContext): void {
  if (!draft.trim() || !draft.trim().startsWith("#")) {
    throw new Error("Invalid fanfic draft: draft must be non-empty Markdown");
  }
  for (const requiredScene of context.requiredScenes) {
    if (!hasRequiredSceneSignal(draft, requiredScene)) {
      throw new Error("Invalid fanfic draft: required scene missing: " + requiredScene);
    }
  }
  const minChars = Math.ceil(context.targetWordCount * 0.6);
  if (countDraftChars(draft) < minChars) {
    throw new Error("Invalid fanfic draft: below 60% target word count");
  }
  const forbiddenPhrases = buildForbiddenPhrases(context);
  for (const phrase of forbiddenPhrases) {
    if (draft.includes(phrase)) {
      throw new Error("Invalid fanfic draft: forbidden phrase present: " + phrase);
    }
  }
}

function hasRequiredSceneSignal(draft: string, requiredScene: string): boolean {
  if (draft.includes(requiredScene)) return true;
  const phraseSignals = extractSceneSignals(requiredScene);
  if (phraseSignals.length === 0) return false;
  const matchedPhrases = phraseSignals.filter((signal) => draft.includes(signal));
  if (matchedPhrases.length >= Math.min(2, phraseSignals.length)) return true;

  const charSignals = extractContentChars(requiredScene);
  const matchedChars = charSignals.filter((signal) => draft.includes(signal));
  const minChars = Math.min(charSignals.length, Math.max(3, Math.ceil(charSignals.length * 0.6)));
  return matchedChars.length >= minChars;
}

function extractSceneSignals(requiredScene: string): string[] {
  const text = normalizeSignalText(requiredScene);
  const signals = new Set<string>();
  for (let index = 0; index < text.length - 1; index += 1) {
    const signal = text.slice(index, index + 2);
    if (!/[的了在里把向她他它是和与]/.test(signal)) {
      signals.add(signal);
    }
  }
  return [...signals];
}

function extractContentChars(requiredScene: string): string[] {
  return [...new Set(normalizeSignalText(requiredScene).split("").filter((char) => !/[的了在里是和与]/.test(char)))];
}

function normalizeSignalText(text: string): string {
  return text.replace(/[\s，。！？、；：“”‘’（）()《》.!,?:;]+/g, "");
}

function countDraftChars(draft: string): number {
  return draft.replace(/[\s#*_`>\-—，。！？、；：“”‘’（）()《》.!,?:;]+/g, "").length;
}

function buildForbiddenPhrases(context: FanficWriterContext): string[] {
  const text = context.avoidChecks.join(" ");
  const phrases: string[] = [];
  if (text.includes("突然告白")) {
    phrases.push("我喜欢你", "我爱你", "喜欢你", "爱你");
  }
  if (text.includes("恋爱脑")) {
    phrases.push("恋爱脑");
  }
  return phrases;
}
