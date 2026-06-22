import { endpoints, type ModelEndpoint } from "../models.js";
import type { FanficReview } from "./reviewer.js";
import type { FanficWriterContext } from "./writer-context.js";

export interface FanficRewriterOptions { endpoint?: ModelEndpoint; }

export async function rewriteFanficDraft(
  context: FanficWriterContext,
  draft: string,
  review: FanficReview,
  options: FanficRewriterOptions = {},
): Promise<string> {
  const endpoint = options.endpoint ?? endpoints.fanficRewrite;
  const response = await endpoint.client.messages.create({
    model: endpoint.model,
    max_tokens: Math.max(1200, Math.ceil(context.targetWordCount * 1.8)),
    system: buildSystemPrompt(),
    messages: [{ role: "user", content: buildUserPrompt(context, draft, review) }],
  });
  const rewritten = response.content
    .filter((block) => block.type === "text")
    .map((block) => (block as { type: "text"; text: string }).text)
    .join("")
    .trim();
  validateRewrite(rewritten, context);
  return rewritten;
}

function buildSystemPrompt(): string {
  return [
    "你是同人短篇 rewriter，只根据 review 修改当前稿。",
    "不要重设 CP、时间线或结局倾向，不要解释修改过程。",
    "输出 Markdown 正文。",
  ].join("\n");
}

function buildUserPrompt(context: FanficWriterContext, draft: string, review: FanficReview): string {
  return [
    "请根据 reviewBrief 和 issues 改写草稿。",
    "必须保留 requiredScenes，requiredScenes 中的每个原文短语尽量完整出现在正文里；遵守 avoidChecks。",
    "必须对照 plan.scenes[].narrativeStrategy 修复：删去解释性心理和作者总结，补入可见动作或物件，保留 withheldInterior 的留白，按 closingMove 压低结尾。",
    "不得为了执行 narrativeStrategy 改动 CP、时间线、canon facts 或 requiredScenes。",
    "",
    "## Writer Context",
    JSON.stringify(context, null, 2),
    "",
    "## Review",
    JSON.stringify(review, null, 2),
    "",
    "## Current Draft",
    draft,
  ].join("\n");
}

function validateRewrite(draft: string, context: FanficWriterContext): void {
  if (!draft.trim() || !draft.trim().startsWith("#")) throw new Error("Invalid fanfic rewrite: draft must be Markdown");
  for (const requiredScene of context.requiredScenes) {
    if (!hasRequiredSceneSignal(draft, requiredScene)) throw new Error("Invalid fanfic rewrite: required scene missing: " + requiredScene);
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
    if (!/[的了在里把向她他它是和与]/.test(signal)) signals.add(signal);
  }
  return [...signals];
}

function extractContentChars(requiredScene: string): string[] {
  return [...new Set(normalizeSignalText(requiredScene).split("").filter((char) => !/[的了在里是和与]/.test(char)))];
}

function normalizeSignalText(text: string): string {
  return text.replace(/[\s，。！？、；：“”‘’（）()《》.!,?:;]+/g, "");
}
