/**
 * verify/runner.ts - 验证模式入口
 *
 * 用法：
 *   npx tsx src/verify/runner.ts          # 运行验证并清理
 *   npx tsx src/verify/runner.ts --keep   # 运行验证并保留测试文件
 *   npm run verify                        # 同上（package.json 快捷方式）
 *
 * 做的事情：
 *   1. 设置 VERIFY_MODE=1 环境变量
 *   2. 将 Mock API 工厂注册到 globalThis（models.ts 会读取）
 *   3. 动态 import Orchestrator（确保 models.ts 拿到 mock 工厂）
 *   4. 创建测试夹具，运行全流程
 *   5. 收集并输出验证报告
 *   6. 清理测试目录（可选）
 *
 * 可插拔设计：
 *   - 仅在运行此脚本时才启用 VERIFY_MODE
 *   - 正常 `npx tsx src/novel-agent.ts` 不受影响
 *   - models.ts 的 mock 注入通过 globalThis 传递，零侵入
 */

// ⚠️ 必须在任何 import 之前设置环境变量
process.env.VERIFY_MODE = "1";

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║              Novel Agent 验证模式 (Verify Mode)              ║");
  console.log("║                                                              ║");
  console.log("║  Mock API 拦截所有 LLM 调用，自动响应 HITL 提示              ║");
  console.log("║  验证全流程链路完整性和文件产物正确性                         ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log("");

  // Step 1: 加载 mock 模块（不触发 models.ts）
  const { createMockClient } = await import("./mock-api.js");
  const { report, printVerifyReport } = await import("./report.js");

  // Step 2: 注册 mock 工厂到 globalThis（models.ts 在初始化时会读取这个全局变量）
  (globalThis as Record<string, unknown>).__VERIFY_MOCK_CLIENT_FACTORY__ = createMockClient;

  // Step 3: 现在才加载 Orchestrator（触发 models.ts 初始化，会读到 mock 工厂）
  const { Orchestrator } = await import("../orchestrator.js");
  const { setupFixtures, cleanupFixtures, VERIFY_NOVEL_TITLE, VERIFY_NOVEL_DIR } = await import("./fixtures.js");

  // 1. 初始化
  report.reset();
  report.recordPhaseStart("setup");
  await setupFixtures();
  report.recordPhaseEnd("setup");

  // 2. 运行全流程
  console.log("\n[verify] 启动 Orchestrator 全流程...\n");

  try {
    report.recordPhaseStart("planning");
    report.recordPhaseStart("writing");

    const orchestrator = new Orchestrator(VERIFY_NOVEL_TITLE, VERIFY_NOVEL_DIR);
    await orchestrator.run();

    report.recordPhaseEnd("planning");
    report.recordPhaseEnd("writing");
    report.recordPhaseEnd("verify");
  } catch (err) {
    report.addIssue("error", "orchestrator", `Orchestrator 异常: ${err}`);
    console.error("\n[verify] ❌ Orchestrator 执行异常:", err);
  }

  // 3. 输出验证报告
  await printVerifyReport(VERIFY_NOVEL_DIR);

  // 4. 清理（保留 --keep 参数可跳过清理）
  const keepFiles = process.argv.includes("--keep");
  if (keepFiles) {
    console.log(`[verify] 保留测试文件: ${VERIFY_NOVEL_DIR}`);
  } else {
    await cleanupFixtures();
  }
}

main().catch((err) => {
  console.error("[verify] 致命错误:", err);
  process.exit(1);
});
