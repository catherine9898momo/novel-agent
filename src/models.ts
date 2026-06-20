/**
 * models.ts - 多模型路由配置（多服务商支持）
 *
 * 每个场景角色独立配置：模型 ID + Provider
 * 支持多个服务商：Anthropic / DeepSeek Web / 智谱 / MiniMax / OpenAI
 *
 * 环境变量命名规则：
 *   {ROLE}_MODEL    — 模型 ID
 *   {ROLE}_PROVIDER — 服务商 (anthropic | deepseek-web | openai-compatible)
 *   {ROLE}_API_KEY  — API Key（不设则回退默认）
 *   {ROLE}_BASE_URL — Base URL（不设则回退默认）
 *
 * DeepSeek Web 特殊配置：
 *   DEEPSEEK_TOKEN   — Bearer Token
 *   DEEPSEEK_COOKIES — Session Cookies
 *
 * 角色列表：
 *   - WRITE:    正文创作    → 建议 Claude Sonnet
 *   - FANFIC_WRITE: 同人短篇写作 → 默认回退 WRITE
 *   - PLAN:     规划策划    → 建议 DeepSeek / GLM
 *   - FANFIC_PLAN: 同人短篇规划 → 默认回退 PLAN
 *   - REVIEW:   审稿分析    → 建议 DeepSeek / GLM
 *   - FANFIC_REVIEW: 同人短篇审阅 → 默认回退 REVIEW
 *   - FANFIC_REWRITE: 同人短篇改写 → 默认回退 WRITE
 *   - COMPRESS: 上下文压缩  → 建议 MiniMax
 *   - EXTRACT:  辅助提取    → 建议 MiniMax
 *   - IDEA:     同人创意解析 → 建议 DeepSeek / GLM
 *   - OPUS:     关键章升级  → 建议 Claude Opus
 */

import Anthropic from "@anthropic-ai/sdk";
import { OpenAICompatibleClient } from "./providers/openai-compatible.js";
import * as dotenv from "dotenv";
dotenv.config();

// ── Provider 类型 ────────────────────────────────────────

export type ProviderType = "anthropic" | "deepseek-web" | "openai-compatible";

export interface ModelEndpoint {
  client: Anthropic;  // 兼容 Anthropic SDK 接口
  model: string;
  provider: ProviderType;
}

// ── DeepSeek Web Client 懒加载 ──────────────────────────

let _deepseekClient: unknown = undefined;

function getDeepSeekClient(): unknown {
  if (_deepseekClient === undefined) {
    // 懒加载，避免循环依赖
    import("./providers/deepseek-web.js")
      .then(({ createDeepSeekClient }) => {
        _deepseekClient = createDeepSeekClient();
      })
      .catch(() => {
        _deepseekClient = null;
      });
  }
  return _deepseekClient;
}

// ── 默认配置（全局兜底）──────────────────────────────────
function inferProviderFromBaseURL(baseURL?: string): ProviderType | undefined {
  if (!baseURL) return undefined;
  const normalized = baseURL.replace(/\/+$/, "");
  if (normalized.includes("api.deepseek.com") && !normalized.endsWith("/anthropic")) {
    return "openai-compatible";
  }
  return undefined;
}

const DEFAULT_API_KEY = process.env.API_KEY ?? process.env.DEEPSEEK_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? "";
const DEFAULT_BASE_URL = process.env.BASE_URL ?? process.env.ANTHROPIC_BASE_URL;
const DEFAULT_MODEL = process.env.MODEL ?? process.env.MODEL_ID ?? "claude-sonnet-4-20250514";
const DEFAULT_PROVIDER: ProviderType =
  (process.env.DEFAULT_PROVIDER as ProviderType | undefined) ?? inferProviderFromBaseURL(DEFAULT_BASE_URL) ?? "anthropic";

// ── client 缓存（相同 baseURL + apiKey 复用同一个 client）──
const clientCache = new Map<string, Anthropic>();
const openAIClientCache = new Map<string, OpenAICompatibleClient>();

function getOrCreateClient(apiKey: string, baseURL?: string, provider?: ProviderType): Anthropic {
  if (provider === "openai-compatible") {
    const cacheKey = `oai::${apiKey}::${baseURL ?? "default"}`;
    let client = openAIClientCache.get(cacheKey);
    if (!client) {
      client = new OpenAICompatibleClient({ apiKey, baseURL: baseURL ?? "" });
      openAIClientCache.set(cacheKey, client);
    }
    return client as unknown as Anthropic;
  }

  const cacheKey = `${apiKey}::${baseURL ?? "default"}`;
  let client = clientCache.get(cacheKey);
  if (!client) {
    client = new Anthropic({
      apiKey,
      baseURL,
      defaultHeaders: {
        "Authorization": `Bearer ${apiKey}`,
      },
    });
    clientCache.set(cacheKey, client);
  }
  return client;
}

/**
 * 从环境变量构建一个角色的 ModelEndpoint
 * 未配置的字段回退到默认值
 */
function buildEndpoint(role: string, fallbackRole?: string): ModelEndpoint {
  const apiKey = process.env[`${role}_API_KEY`] ?? (fallbackRole ? process.env[`${fallbackRole}_API_KEY`] : undefined) ?? DEFAULT_API_KEY;
  const baseURL = process.env[`${role}_BASE_URL`] ?? (fallbackRole ? process.env[`${fallbackRole}_BASE_URL`] : undefined) ?? DEFAULT_BASE_URL;
  const model = process.env[`${role}_MODEL`] ?? (fallbackRole ? process.env[`${fallbackRole}_MODEL`] : undefined) ?? DEFAULT_MODEL;
  const provider =
    (process.env[`${role}_PROVIDER`] as ProviderType | undefined) ??
    (fallbackRole ? process.env[`${fallbackRole}_PROVIDER`] as ProviderType | undefined : undefined) ??
    inferProviderFromBaseURL(baseURL) ??
    DEFAULT_PROVIDER;
  
  // DeepSeek Web 特殊处理
  if (provider === "deepseek-web") {
    const dsClient = getDeepSeekClient();
    if (dsClient) {
      return {
        client: dsClient as unknown as Anthropic,
        model: process.env[`${role}_MODEL`] ?? "deepseek-chat",
        provider: "deepseek-web",
      };
    }
    // DeepSeek 配置失败，回退到默认
    console.warn(`[models] DeepSeek Web 配置缺失，${role} 回退到 Anthropic`);
  }

  return {
    client: getOrCreateClient(apiKey, baseURL, provider),
    model,
    provider: provider === "deepseek-web" ? "anthropic" : provider,
  };
}

// ── 导出各角色端点 ──────────────────────────────────────
export const endpoints = {
  /** 正文创作：文笔、角色对话、情感表达 */
  write:    buildEndpoint("WRITE"),
  /** 同人短篇写作：CP 张力、canon 贴合、梗兑现 */
  fanficWrite: buildEndpoint("FANFIC_WRITE", "WRITE"),
  /** 同人短篇改写：根据 review 改写当前稿 */
  fanficRewrite: buildEndpoint("FANFIC_REWRITE", "WRITE"),
  /** 规划/策划：大纲、人物、关系、章节列表、单章计划 */
  plan:     buildEndpoint("PLAN"),
  /** 审稿/分析：自评、连贯性审计、全文分析 */
  review:   buildEndpoint("REVIEW"),
  /** 同人短篇审阅：canon、required scenes、雷点、情绪张力 */
  fanficReview: buildEndpoint("FANFIC_REVIEW", "REVIEW"),
  /** 上下文压缩：autoCompress 历史摘要 */
  compress: buildEndpoint("COMPRESS"),
  /** 辅助提取：角色声音档案等 */
  extract:  buildEndpoint("EXTRACT"),
  /** 同人创意解析：脑洞拆解、约束提取、故事卡生成 */
  idea:     buildEndpoint("IDEA"),
  /** 同人短篇规划：大场景、beats、字数和约束映射 */
  fanficPlan: buildEndpoint("FANFIC_PLAN", "PLAN"),
  /** 疑难分析：全文分析、连贯性审计、第二审稿人 */
  audit:    buildEndpoint("AUDIT"),
  /** 关键章节升级：首章/高潮/结尾/重写失败升级 */
  opus:     buildEndpoint("OPUS"),
};

export type ModelRole = keyof typeof endpoints;

/**
 * 打印当前模型路由配置（启动时调用，方便确认）
 */
export function printModelConfig(): void {
  console.log("\n── 模型路由配置 ──────────────────────────────");
  const labels: Record<ModelRole, string> = {
    write:    "正文创作",
    fanficWrite: "同人短篇写作",
    fanficRewrite: "同人短篇改写",
    plan:     "规划策划",
    fanficPlan: "同人短篇规划",
    review:   "章节自评",
    fanficReview: "同人短篇审阅",
    compress: "上下文压缩",
    extract:  "辅助提取",
    idea:     "同人创意解析",
    audit:    "疑难分析",
    opus:     "关键章升级",
  };
  for (const [role, label] of Object.entries(labels)) {
    const ep = endpoints[role as ModelRole];
    const base = ep.client.baseURL || "(默认)";
    const prov = ep.provider === "deepseek-web" ? "[DeepSeek Web]" : "";
    console.log(`  ${label} (${role}):  ${ep.model}  ← ${base} ${prov}`);
  }
  console.log("───────────────────────────────────────────────\n");
}
