import { describe, it, expect, afterEach, vi } from "vitest";

// mock dotenv 防止 .env 文件干扰测试
vi.mock("dotenv", () => ({ config: vi.fn() }));

// 保存原始 env，测试后恢复
const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe("models.ts - endpoint creation & env fallback", () => {
  it("默认回退：未设置角色 env 时使用全局默认值", async () => {
    process.env.ANTHROPIC_API_KEY = "default-key";
    process.env.ANTHROPIC_BASE_URL = "https://default.example.com";
    process.env.MODEL_ID = "default-model";
    delete process.env.API_KEY;
    delete process.env.BASE_URL;
    delete process.env.MODEL;
    // 清除所有角色特定配置
    delete process.env.WRITE_MODEL;
    delete process.env.WRITE_API_KEY;
    delete process.env.WRITE_BASE_URL;

    const { endpoints } = await import("../src/models.js");

    expect(endpoints.write.model).toBe("default-model");
    expect(endpoints.write.client.apiKey).toBe("default-key");
    expect(endpoints.write.client.baseURL).toBe("https://default.example.com");
  });

  it("角色级覆盖：PLAN_ 前缀的 env 覆盖默认值", async () => {
    process.env.ANTHROPIC_API_KEY = "default-key";
    process.env.ANTHROPIC_BASE_URL = "https://default.example.com";
    process.env.MODEL_ID = "default-model";
    delete process.env.API_KEY;
    delete process.env.BASE_URL;
    delete process.env.MODEL;
    process.env.PLAN_MODEL = "glm-4-plus";
    process.env.PLAN_API_KEY = "zhipu-key";
    process.env.PLAN_BASE_URL = "https://open.bigmodel.cn/api/anthropic";

    const { endpoints } = await import("../src/models.js");

    expect(endpoints.plan.model).toBe("glm-4-plus");
    expect(endpoints.plan.client.apiKey).toBe("zhipu-key");
    expect(endpoints.plan.client.baseURL).toBe("https://open.bigmodel.cn/api/anthropic");
    // write 应该仍然是默认值
    expect(endpoints.write.model).toBe("default-model");
  });

  it("部分覆盖：只设 MODEL 不设 API_KEY 时，API_KEY 回退默认", async () => {
    process.env.ANTHROPIC_API_KEY = "default-key";
    process.env.MODEL_ID = "default-model";
    delete process.env.API_KEY;
    delete process.env.BASE_URL;
    delete process.env.MODEL;
    process.env.COMPRESS_MODEL = "minimax-text-01";
    delete process.env.COMPRESS_API_KEY;
    delete process.env.COMPRESS_BASE_URL;

    const { endpoints } = await import("../src/models.js");

    expect(endpoints.compress.model).toBe("minimax-text-01");
    expect(endpoints.compress.client.apiKey).toBe("default-key");
  });

  it("client 缓存：相同 apiKey + baseURL 复用同一个 client 实例", async () => {
    process.env.ANTHROPIC_API_KEY = "shared-key";
    process.env.ANTHROPIC_BASE_URL = "https://shared.example.com";
    process.env.MODEL_ID = "model-a";
    delete process.env.API_KEY;
    delete process.env.BASE_URL;
    delete process.env.MODEL;
    // 清除所有可能干扰的角色级 env
    for (const role of ["WRITE", "REVIEW", "PLAN", "COMPRESS", "EXTRACT", "AUDIT", "OPUS"]) {
      delete process.env[`${role}_API_KEY`];
      delete process.env[`${role}_BASE_URL`];
      delete process.env[`${role}_MODEL`];
    }

    const { endpoints } = await import("../src/models.js");

    expect(endpoints.write.client).toBe(endpoints.review.client);
  });

  it("不同 apiKey → 不同 client 实例", async () => {
    process.env.ANTHROPIC_API_KEY = "default-key";
    process.env.ANTHROPIC_BASE_URL = "https://default.example.com";
    delete process.env.API_KEY;
    delete process.env.BASE_URL;
    delete process.env.MODEL;
    process.env.PLAN_API_KEY = "other-key";
    process.env.PLAN_BASE_URL = "https://other.example.com";

    const { endpoints } = await import("../src/models.js");

    expect(endpoints.write.client).not.toBe(endpoints.plan.client);
  });

  it("所有 12 个角色端点都存在", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const { endpoints } = await import("../src/models.js");

    const roles = ["write", "plan", "review", "compress", "extract", "audit", "opus", "idea", "fanficPlan", "fanficWrite", "fanficReview", "fanficRewrite"] as const;
    for (const role of roles) {
      expect(endpoints[role]).toBeDefined();
      expect(endpoints[role].client).toBeDefined();
      expect(typeof endpoints[role].model).toBe("string");
    }
  });

  it("IDEA_ 前缀的 env 覆盖创意解析模型", async () => {
    process.env.ANTHROPIC_API_KEY = "default-key";
    process.env.ANTHROPIC_BASE_URL = "https://default.example.com";
    process.env.MODEL_ID = "default-model";
    delete process.env.API_KEY;
    delete process.env.BASE_URL;
    delete process.env.MODEL;
    process.env.IDEA_MODEL = "deepseek-v4-pro";
    process.env.IDEA_API_KEY = "idea-key";
    process.env.IDEA_BASE_URL = "https://api.deepseek.com";

    const { endpoints } = await import("../src/models.js");

    expect(endpoints.idea.provider).toBe("openai-compatible");
    expect(endpoints.idea.model).toBe("deepseek-v4-pro");
    expect(endpoints.idea.client.baseURL).toBe("https://api.deepseek.com");
    expect((endpoints.idea.client as unknown as { apiKey_public: string }).apiKey_public).toBe("idea-key");
  });

  it("FANFIC_PLAN_ 前缀覆盖短篇同人规划模型", async () => {
    process.env.ANTHROPIC_API_KEY = "default-key";
    process.env.ANTHROPIC_BASE_URL = "https://default.example.com";
    process.env.MODEL_ID = "default-model";
    delete process.env.API_KEY;
    delete process.env.BASE_URL;
    delete process.env.MODEL;
    process.env.PLAN_MODEL = "plan-model";
    process.env.PLAN_API_KEY = "plan-key";
    process.env.PLAN_BASE_URL = "https://plan.example.com";
    process.env.FANFIC_PLAN_MODEL = "fanfic-plan-model";
    process.env.FANFIC_PLAN_API_KEY = "fanfic-plan-key";
    process.env.FANFIC_PLAN_BASE_URL = "https://api.deepseek.com";

    const { endpoints } = await import("../src/models.js");

    expect(endpoints.fanficPlan.provider).toBe("openai-compatible");
    expect(endpoints.fanficPlan.model).toBe("fanfic-plan-model");
    expect(endpoints.fanficPlan.client.baseURL).toBe("https://api.deepseek.com");
    expect((endpoints.fanficPlan.client as unknown as { apiKey_public: string }).apiKey_public).toBe("fanfic-plan-key");
  });

  it("FANFIC_PLAN_ 未配置时回退到 PLAN_", async () => {
    process.env.ANTHROPIC_API_KEY = "default-key";
    process.env.MODEL_ID = "default-model";
    delete process.env.API_KEY;
    delete process.env.BASE_URL;
    delete process.env.MODEL;
    delete process.env.FANFIC_PLAN_MODEL;
    delete process.env.FANFIC_PLAN_API_KEY;
    delete process.env.FANFIC_PLAN_BASE_URL;
    delete process.env.FANFIC_PLAN_PROVIDER;
    process.env.PLAN_MODEL = "shared-plan-model";
    process.env.PLAN_API_KEY = "shared-plan-key";
    process.env.PLAN_BASE_URL = "https://api.deepseek.com";

    const { endpoints } = await import("../src/models.js");

    expect(endpoints.fanficPlan.provider).toBe("openai-compatible");
    expect(endpoints.fanficPlan.model).toBe("shared-plan-model");
    expect(endpoints.fanficPlan.client.baseURL).toBe("https://api.deepseek.com");
  });

  it("FANFIC_WRITE_ 前缀覆盖同人短篇写作模型", async () => {
    process.env.ANTHROPIC_API_KEY = "default-key";
    process.env.MODEL_ID = "default-model";
    delete process.env.API_KEY;
    delete process.env.BASE_URL;
    delete process.env.MODEL;
    process.env.WRITE_MODEL = "write-model";
    process.env.WRITE_API_KEY = "write-key";
    process.env.WRITE_BASE_URL = "https://write.example.com";
    process.env.FANFIC_WRITE_MODEL = "fanfic-write-model";
    process.env.FANFIC_WRITE_API_KEY = "fanfic-write-key";
    process.env.FANFIC_WRITE_BASE_URL = "https://api.deepseek.com";

    const { endpoints } = await import("../src/models.js");

    expect(endpoints.fanficWrite.provider).toBe("openai-compatible");
    expect(endpoints.fanficWrite.model).toBe("fanfic-write-model");
    expect(endpoints.fanficWrite.client.baseURL).toBe("https://api.deepseek.com");
    expect((endpoints.fanficWrite.client as unknown as { apiKey_public: string }).apiKey_public).toBe("fanfic-write-key");
  });

  it("FANFIC_WRITE_ 未配置时回退到 WRITE_", async () => {
    process.env.ANTHROPIC_API_KEY = "default-key";
    process.env.MODEL_ID = "default-model";
    delete process.env.API_KEY;
    delete process.env.BASE_URL;
    delete process.env.MODEL;
    delete process.env.FANFIC_WRITE_MODEL;
    delete process.env.FANFIC_WRITE_API_KEY;
    delete process.env.FANFIC_WRITE_BASE_URL;
    delete process.env.FANFIC_WRITE_PROVIDER;
    process.env.WRITE_MODEL = "shared-write-model";
    process.env.WRITE_API_KEY = "shared-write-key";
    process.env.WRITE_BASE_URL = "https://api.deepseek.com";

    const { endpoints } = await import("../src/models.js");

    expect(endpoints.fanficWrite.provider).toBe("openai-compatible");
    expect(endpoints.fanficWrite.model).toBe("shared-write-model");
    expect(endpoints.fanficWrite.client.baseURL).toBe("https://api.deepseek.com");
  });

  it("FANFIC_REVIEW_ 前缀覆盖同人短篇审阅模型", async () => {
    process.env.ANTHROPIC_API_KEY = "default-key";
    process.env.MODEL_ID = "default-model";
    delete process.env.API_KEY;
    delete process.env.BASE_URL;
    delete process.env.MODEL;
    process.env.REVIEW_MODEL = "review-model";
    process.env.REVIEW_API_KEY = "review-key";
    process.env.REVIEW_BASE_URL = "https://review.example.com";
    process.env.FANFIC_REVIEW_MODEL = "fanfic-review-model";
    process.env.FANFIC_REVIEW_API_KEY = "fanfic-review-key";
    process.env.FANFIC_REVIEW_BASE_URL = "https://api.deepseek.com";

    const { endpoints } = await import("../src/models.js");

    expect(endpoints.fanficReview.provider).toBe("openai-compatible");
    expect(endpoints.fanficReview.model).toBe("fanfic-review-model");
    expect(endpoints.fanficReview.client.baseURL).toBe("https://api.deepseek.com");
    expect((endpoints.fanficReview.client as unknown as { apiKey_public: string }).apiKey_public).toBe("fanfic-review-key");
  });

  it("FANFIC_REWRITE_ 未配置时回退到 WRITE_", async () => {
    process.env.ANTHROPIC_API_KEY = "default-key";
    process.env.MODEL_ID = "default-model";
    delete process.env.API_KEY;
    delete process.env.BASE_URL;
    delete process.env.MODEL;
    delete process.env.FANFIC_REWRITE_MODEL;
    delete process.env.FANFIC_REWRITE_API_KEY;
    delete process.env.FANFIC_REWRITE_BASE_URL;
    delete process.env.FANFIC_REWRITE_PROVIDER;
    process.env.WRITE_MODEL = "shared-write-model";
    process.env.WRITE_API_KEY = "shared-write-key";
    process.env.WRITE_BASE_URL = "https://api.deepseek.com";

    const { endpoints } = await import("../src/models.js");

    expect(endpoints.fanficRewrite.provider).toBe("openai-compatible");
    expect(endpoints.fanficRewrite.model).toBe("shared-write-model");
    expect(endpoints.fanficRewrite.client.baseURL).toBe("https://api.deepseek.com");
  });

  it("通用 .env 变量可直接配置 DeepSeek OpenAI-compatible API", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.MODEL_ID;
    delete process.env.DEFAULT_PROVIDER;
    process.env.API_KEY = "deepseek-key";
    process.env.BASE_URL = "https://api.deepseek.com";
    process.env.MODEL = "deepseek-v4-pro";

    const { endpoints } = await import("../src/models.js");

    expect(endpoints.write.provider).toBe("openai-compatible");
    expect(endpoints.write.model).toBe("deepseek-v4-pro");
    expect(endpoints.write.client.baseURL).toBe("https://api.deepseek.com");
    expect((endpoints.write.client as unknown as { apiKey_public: string }).apiKey_public).toBe("deepseek-key");
  });

  it("MODEL_ID 未设时使用硬编码默认值", async () => {
    delete process.env.MODEL_ID;
    delete process.env.API_KEY;
    delete process.env.BASE_URL;
    delete process.env.MODEL;
    process.env.ANTHROPIC_API_KEY = "test-key";
    // 清除角色级 MODEL 避免干扰
    for (const role of ["WRITE", "PLAN", "REVIEW", "COMPRESS", "EXTRACT", "AUDIT", "OPUS"]) {
      delete process.env[`${role}_MODEL`];
    }

    const { endpoints } = await import("../src/models.js");

    expect(endpoints.write.model).toBe("claude-sonnet-4-20250514");
  });
});
