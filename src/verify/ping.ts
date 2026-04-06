/**
 * verify/ping.ts - 真实 API 连通性测试
 *
 * 用法：
 *   npx tsx src/verify/ping.ts
 *   npm run ping
 *
 * 对每个角色发一条最小请求，验证 key + endpoint + 模型名都正确。
 */

import * as dotenv from "dotenv";
dotenv.config();

import { endpoints, ModelRole } from "../models.js";

const ROLES: ModelRole[] = ["write", "plan", "review", "compress", "extract", "audit", "opus"];

const ROLE_LABELS: Record<ModelRole, string> = {
  write:    "正文创作",
  plan:     "规划策划",
  review:   "章节自评",
  compress: "上下文压缩",
  extract:  "辅助提取",
  audit:    "疑难分析",
  opus:     "关键章升级",
};

async function pingRole(role: ModelRole): Promise<{ ok: boolean; ms: number; error?: string }> {
  const ep = endpoints[role];
  const start = Date.now();

  try {
    const res = await ep.client.messages.create({
      model: ep.model,
      max_tokens: 10,
      messages: [{ role: "user", content: "reply ok" }],
    });
    const text = res.content?.[0];
    if (!text) throw new Error("空响应");
    return { ok: true, ms: Date.now() - start };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const short = msg.length > 120 ? msg.slice(0, 120) + "…" : msg;
    return { ok: false, ms: Date.now() - start, error: short };
  }
}

async function main() {
  console.log("\n── API 连通性检测 ─────────────────────────────────────");
  console.log("  逐一向每个角色发送最小请求（reply ok）\n");

  let passed = 0;
  let failed = 0;

  for (const role of ROLES) {
    const label = ROLE_LABELS[role];
    const ep = endpoints[role];
    process.stdout.write(`  ${label.padEnd(8)} (${role.padEnd(8)})  ${ep.model.padEnd(24)}  `);

    const result = await pingRole(role);

    if (result.ok) {
      console.log(`✅  ${result.ms}ms`);
      passed++;
    } else {
      console.log(`❌  ${result.ms}ms  →  ${result.error}`);
      failed++;
    }
  }

  console.log("\n───────────────────────────────────────────────────────");
  console.log(`  结果：${passed} 通过 / ${failed} 失败\n`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[ping] 致命错误:", err);
  process.exit(1);
});
