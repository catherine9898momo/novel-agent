/**
 * 链路测试：模型路由 — 验证各场景使用正确的 client + model 组合
 *
 * 策略：用不同 env 配置各角色，然后验证 endpoints 对象中
 * 每个角色拿到的 model 和 client (apiKey/baseURL) 是否符合预期
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

vi.mock("dotenv", () => ({ config: vi.fn() }));

const originalEnv = { ...process.env };

const ALL_ROLES = ["WRITE", "PLAN", "REVIEW", "COMPRESS", "EXTRACT", "AUDIT", "OPUS"];

beforeEach(() => {
  // 清除所有角色级 env，防止 .env 残留值干扰
  for (const role of ALL_ROLES) {
    delete process.env[`${role}_MODEL`];
    delete process.env[`${role}_API_KEY`];
    delete process.env[`${role}_BASE_URL`];
  }
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.MODEL_ID;
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe("链路：多服务商路由完整性", () => {
  it("模拟真实配置：GLM直连 + 代理 + Opus 分离", async () => {
    // 模拟用户实际 .env 配置
    process.env.ANTHROPIC_API_KEY = "proxy-key";
    process.env.ANTHROPIC_BASE_URL = "https://proxy.example.com";
    process.env.MODEL_ID = "claude-sonnet-4-20250514";

    // GLM 直连智谱
    process.env.PLAN_MODEL = "glm-4-plus";
    process.env.PLAN_API_KEY = "zhipu-token";
    process.env.PLAN_BASE_URL = "https://open.bigmodel.cn/api/anthropic";

    process.env.REVIEW_MODEL = "glm-4-plus";
    process.env.REVIEW_API_KEY = "zhipu-token";
    process.env.REVIEW_BASE_URL = "https://open.bigmodel.cn/api/anthropic";

    process.env.EXTRACT_MODEL = "glm-4-plus";
    process.env.EXTRACT_API_KEY = "zhipu-token";
    process.env.EXTRACT_BASE_URL = "https://open.bigmodel.cn/api/anthropic";

    // MiniMax 走代理
    process.env.COMPRESS_MODEL = "minimax-text-01";

    // GPT-5 走代理
    process.env.AUDIT_MODEL = "gpt-5";

    // Opus 走代理
    process.env.OPUS_MODEL = "claude-opus-4-20250514";

    const { endpoints } = await import("../src/models.js");

    // ── write: Claude Sonnet 走代理 ──
    expect(endpoints.write.model).toBe("claude-sonnet-4-20250514");
    expect(endpoints.write.client.apiKey).toBe("proxy-key");
    expect(endpoints.write.client.baseURL).toBe("https://proxy.example.com");

    // ── plan/review/extract: GLM 走智谱直连 ──
    for (const role of ["plan", "review", "extract"] as const) {
      expect(endpoints[role].model).toBe("glm-4-plus");
      expect(endpoints[role].client.apiKey).toBe("zhipu-token");
      expect(endpoints[role].client.baseURL).toBe("https://open.bigmodel.cn/api/anthropic");
    }

    // ── plan/review/extract 共享同一个 client ──
    expect(endpoints.plan.client).toBe(endpoints.review.client);
    expect(endpoints.plan.client).toBe(endpoints.extract.client);

    // ── compress: MiniMax 走代理（model 不同，client 同 write） ──
    expect(endpoints.compress.model).toBe("minimax-text-01");
    expect(endpoints.compress.client.apiKey).toBe("proxy-key");
    expect(endpoints.compress.client).toBe(endpoints.write.client);

    // ── audit: GPT-5 走代理 ──
    expect(endpoints.audit.model).toBe("gpt-5");
    expect(endpoints.audit.client).toBe(endpoints.write.client);

    // ── opus: Claude Opus 走代理 ──
    expect(endpoints.opus.model).toBe("claude-opus-4-20250514");
    expect(endpoints.opus.client).toBe(endpoints.write.client);
  });

  it("全部走代理（极简配置）：只设 MODEL 不设 API_KEY/BASE_URL", async () => {
    process.env.ANTHROPIC_API_KEY = "one-key";
    process.env.ANTHROPIC_BASE_URL = "https://gateway.example.com";
    process.env.MODEL_ID = "claude-sonnet-4-20250514";
    process.env.PLAN_MODEL = "glm-4-plus";
    process.env.REVIEW_MODEL = "glm-4-plus";
    process.env.COMPRESS_MODEL = "minimax-text-01";
    process.env.AUDIT_MODEL = "gpt-5";

    const { endpoints } = await import("../src/models.js");

    // 所有角色共享同一个 client（同 apiKey + baseURL）
    const allClients = [
      endpoints.write.client,
      endpoints.plan.client,
      endpoints.review.client,
      endpoints.compress.client,
      endpoints.extract.client,
      endpoints.audit.client,
      endpoints.opus.client,
    ];
    for (const c of allClients) {
      expect(c).toBe(allClients[0]);
    }

    // model 各不相同
    expect(endpoints.write.model).toBe("claude-sonnet-4-20250514");
    expect(endpoints.plan.model).toBe("glm-4-plus");
    expect(endpoints.compress.model).toBe("minimax-text-01");
    expect(endpoints.audit.model).toBe("gpt-5");
  });
});
