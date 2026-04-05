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
 *   - PLAN:     规划策划    → 建议 DeepSeek / GLM
 *   - REVIEW:   审稿分析    → 建议 DeepSeek / GLM
 *   - COMPRESS: 上下文压缩  → 建议 MiniMax
 *   - EXTRACT:  辅助提取    → 建议 MiniMax
 *   - OPUS:     关键章升级  → 建议 Claude Opus
 */

import Anthropic from "@anthropic-ai/sdk";
import * as dotenv from "dotenv";
dotenv.config();

// ── VERIFY_MODE: Mock API 注入 ──────────────────────────
// 验证模式下，runner.ts 在 import 本模块前将 mock factory 注册到 globalThis
// 这样 buildEndpoint() 在模块初始化时就能读到 mock 工厂，无需 top-level await
const _mockFactory = (globalThis as Record<string, unknown>).__VERIFY_MOCK_CLIENT_FACTORY__ as
  ((role: string) => { messages: unknown; baseURL: string }) | undefined;

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
const DEFAULT_API_KEY  = process.env.ANTHROPIC_API_KEY ?? "";
const DEFAULT_BASE_URL = process.env.ANTHROPIC_BASE_URL;
const DEFAULT_MODEL    = process.env.MODEL_ID ?? "claude-sonnet-4-20250514";
const DEFAULT_PROVIDER: ProviderType = "anthropic";

// ── client 缓存（相同 baseURL + apiKey 复用同一个 client）──
const clientCache = new Map<string, Anthropic>();

function getOrCreateClient(apiKey: string, baseURL?: string): Anthropic {
  const cacheKey = `${apiKey}::${baseURL ?? "default"}`;
  let client = clientCache.get(cacheKey);
  if (!client) {
    client = new Anthropic({
      apiKey,
      baseURL,
      defaultHeaders: {
        "x-api-key": apiKey,
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
function buildEndpoint(role: string): ModelEndpoint {
  // VERIFY_MODE: 返回 Mock 客户端
  if (_mockFactory) {
    return {
      client: _mockFactory(role.toLowerCase()) as unknown as Anthropic,
      model: `mock-${role.toLowerCase()}`,
      provider: "anthropic",
    };
  }

  const provider = (process.env[`${role}_PROVIDER`] as ProviderType) ?? DEFAULT_PROVIDER;
  
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

  const apiKey  = process.env[`${role}_API_KEY`]  ?? DEFAULT_API_KEY;
  const baseURL = process.env[`${role}_BASE_URL`] ?? DEFAULT_BASE_URL;
  const model   = process.env[`${role}_MODEL`]    ?? DEFAULT_MODEL;

  return {
    client: getOrCreateClient(apiKey, baseURL),
    model,
    provider: provider === "deepseek-web" ? "anthropic" : provider,
  };
}

// ── 导出各角色端点 ──────────────────────────────────────
export const endpoints = {
  /** 正文创作：文笔、角色对话、情感表达 */
  write:    buildEndpoint("WRITE"),
  /** 规划/策划：大纲、人物、关系、章节列表、单章计划 */
  plan:     buildEndpoint("PLAN"),
  /** 审稿/分析：自评、连贯性审计、全文分析 */
  review:   buildEndpoint("REVIEW"),
  /** 上下文压缩：autoCompress 历史摘要 */
  compress: buildEndpoint("COMPRESS"),
  /** 辅助提取：角色声音档案等 */
  extract:  buildEndpoint("EXTRACT"),
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
    plan:     "规划策划",
    review:   "章节自评",
    compress: "上下文压缩",
    extract:  "辅助提取",
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
