/**
 * models-live.test.ts - 模型服务连通性集成测试
 *
 * 验证每个角色端点的 API 都能真正调用并返回有效响应。
 * 需要 .env 配置正确的 API Key 和 Base URL。
 *
 * 运行方式：
 *   npx vitest run tests/models-live.test.ts
 *   npm test -- tests/models-live.test.ts
 */

import { describe, it, expect } from "vitest";
import { endpoints, type ModelRole, printModelConfig } from "../src/models.js";

// 每个端点发一个最简请求，验证能拿到响应
const ROLES: { role: ModelRole; label: string }[] = [
  { role: "write",    label: "正文创作" },
  { role: "plan",     label: "规划策划" },
  { role: "review",   label: "章节自评" },
  { role: "compress", label: "上下文压缩" },
  { role: "extract",  label: "辅助提取" },
  { role: "audit",    label: "疑难分析" },
  { role: "opus",     label: "关键章升级" },
];

// 打印配置，方便排查
printModelConfig();

describe("模型服务连通性测试（实际 API 调用）", () => {
  for (const { role, label } of ROLES) {
    it(`${label} (${role}) — 能正常调用并返回文本`, async () => {
      const ep = endpoints[role];

      let response;
      const startTime = Date.now();
      try {
        response = await ep.client.messages.create({
          model: ep.model,
          max_tokens: 32,
          messages: [{ role: "user", content: "Hi, reply with OK" }],
        });
      } catch (err: unknown) {
        const e = err as Error & { status?: number };
        const base = ep.client.baseURL || "(default)";
        console.error(
          `  ❌ ${label} (${role}): ${e.status ?? "?"} | ` +
          `model=${ep.model} | base=${base}\n` +
          `     ${e.message.slice(0, 120)}`
        );
        throw new Error(
          `${label} (${role}) 调用失败 [${e.status ?? "?"}]: ${e.message.slice(0, 200)}\n` +
          `  → 请检查 .env 中 ${role.toUpperCase()}_MODEL / ${role.toUpperCase()}_API_KEY / ${role.toUpperCase()}_BASE_URL 配置`
        );
      }
      const elapsed = Date.now() - startTime;

      // 基本结构验证
      expect(response).toBeDefined();
      expect(response.id).toBeTruthy();
      expect(response.role).toBe("assistant");
      expect(response.content).toBeInstanceOf(Array);
      expect(response.content.length).toBeGreaterThan(0);

      // 第一个 content block 应该是 text 类型
      const firstBlock = response.content[0];
      expect(firstBlock.type).toBe("text");
      if (firstBlock.type === "text") {
        expect(firstBlock.text.length).toBeGreaterThan(0);
      }

      // usage 验证
      expect(response.usage).toBeDefined();
      expect(response.usage.input_tokens).toBeGreaterThan(0);
      expect(response.usage.output_tokens).toBeGreaterThan(0);

      // stop_reason 应该是正常结束
      expect(["end_turn", "stop_sequence", "max_tokens"]).toContain(response.stop_reason);

      // 打印摘要
      const text = firstBlock.type === "text" ? firstBlock.text : "";
      console.log(
        `  ✅ ${label} (${role}): ${elapsed}ms | ` +
        `${response.usage.input_tokens}+${response.usage.output_tokens} tokens | ` +
        `model=${response.model} | "${text.slice(0, 30)}"`
      );
    }, 30_000); // 30s 超时，网络慢也能跑完
  }
});

describe("流式调用连通性测试", () => {
  // 只测 write 和 plan 两个最常用的端点，避免过多 API 消耗
  const streamRoles: { role: ModelRole; label: string }[] = [
    { role: "write", label: "正文创作" },
    { role: "plan",  label: "规划策划" },
  ];

  for (const { role, label } of streamRoles) {
    it(`${label} (${role}) — stream 流式调用正常`, async () => {
      const ep = endpoints[role];

      const startTime = Date.now();
      let stream;
      try {
        stream = ep.client.messages.stream({
          model: ep.model,
          max_tokens: 32,
          messages: [{ role: "user", content: "Hi, reply with OK" }],
        });
      } catch (err: unknown) {
        const e = err as Error & { status?: number };
        console.error(`  ❌ ${label} (${role}) stream 创建失败: ${e.message.slice(0, 120)}`);
        throw e;
      }

      const chunks: string[] = [];
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          chunks.push(event.delta.text);
        }
      }

      const finalMessage = await stream.finalMessage();
      const elapsed = Date.now() - startTime;

      // 验证收到了流式 chunk
      expect(chunks.length).toBeGreaterThan(0);
      const fullText = chunks.join("");
      expect(fullText.length).toBeGreaterThan(0);

      // 验证 finalMessage 一致性
      expect(finalMessage.usage).toBeDefined();
      expect(finalMessage.usage.output_tokens).toBeGreaterThan(0);

      console.log(
        `  ✅ ${label} (${role}) stream: ${elapsed}ms | ` +
        `${chunks.length} chunks | ` +
        `${finalMessage.usage.input_tokens}+${finalMessage.usage.output_tokens} tokens | ` +
        `"${fullText.slice(0, 30)}"`
      );
    }, 30_000);
  }
});
