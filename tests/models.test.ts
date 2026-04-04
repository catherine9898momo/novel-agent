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
    process.env.PLAN_API_KEY = "other-key";
    process.env.PLAN_BASE_URL = "https://other.example.com";

    const { endpoints } = await import("../src/models.js");

    expect(endpoints.write.client).not.toBe(endpoints.plan.client);
  });

  it("所有 7 个角色端点都存在", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const { endpoints } = await import("../src/models.js");

    const roles = ["write", "plan", "review", "compress", "extract", "audit", "opus"] as const;
    for (const role of roles) {
      expect(endpoints[role]).toBeDefined();
      expect(endpoints[role].client).toBeDefined();
      expect(typeof endpoints[role].model).toBe("string");
    }
  });

  it("MODEL_ID 未设时使用硬编码默认值", async () => {
    delete process.env.MODEL_ID;
    process.env.ANTHROPIC_API_KEY = "test-key";
    // 清除角色级 MODEL 避免干扰
    for (const role of ["WRITE", "PLAN", "REVIEW", "COMPRESS", "EXTRACT", "AUDIT", "OPUS"]) {
      delete process.env[`${role}_MODEL`];
    }

    const { endpoints } = await import("../src/models.js");

    expect(endpoints.write.model).toBe("claude-sonnet-4-20250514");
  });
});
