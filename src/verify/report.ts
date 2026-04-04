/**
 * verify/report.ts - 验证报告收集与输出
 *
 * 收集 Mock API 的所有调用记录，生成结构化验证报告。
 * 报告内容：
 *   - 流程完整性（哪些阶段被触发）
 *   - API 调用链路（每次调用的角色、prompt 摘要、响应类型）
 *   - 工具调用记录（哪些工具被调用、参数摘要）
 *   - 文件产物检查（哪些文件被生成）
 *   - 问题和警告
 */

import fs from "fs/promises";
import path from "path";

// ── 数据结构 ──────────────────────────────────────────────

export interface ApiCallRecord {
  seq: number;               // 调用序号
  timestamp: number;
  role: string;              // 推断的角色（planner/writer/reviewer/...）
  agentType: string;         // 更具体的类型（outline/chapter-proposal/...）
  isAgentLoop: boolean;      // 是否 agentLoop 多轮调用
  isFollowUp: boolean;       // 是否 agentLoop 的后续轮次
  systemPromptPreview: string;  // system prompt 前 200 字
  userMessagePreview: string;   // 用户消息前 200 字
  responseType: "tool_use" | "text" | "json";
  toolsCalled: string[];     // 返回的工具名列表
  durationMs: number;
}

export interface ToolCallRecord {
  seq: number;
  toolName: string;
  inputPreview: string;      // 参数摘要（前 150 字）
  outputPreview: string;     // 结果摘要（前 150 字）
}

export interface PhaseRecord {
  name: string;
  started: boolean;
  completed: boolean;
  apiCalls: number;
  toolCalls: number;
}

export interface VerifyIssue {
  severity: "error" | "warning" | "info";
  phase: string;
  message: string;
}

// ── 报告收集器（单例）──────────────────────────────────────

class VerifyReportCollector {
  apiCalls: ApiCallRecord[] = [];
  toolCalls: ToolCallRecord[] = [];
  issues: VerifyIssue[] = [];
  phases: Map<string, PhaseRecord> = new Map();
  startTime: number = Date.now();

  private apiSeq = 0;
  private toolSeq = 0;

  recordApiCall(record: Omit<ApiCallRecord, "seq">): void {
    this.apiCalls.push({ ...record, seq: ++this.apiSeq });
  }

  recordToolCall(record: Omit<ToolCallRecord, "seq">): void {
    this.toolCalls.push({ ...record, seq: ++this.toolSeq });
  }

  recordPhaseStart(name: string): void {
    if (!this.phases.has(name)) {
      this.phases.set(name, { name, started: true, completed: false, apiCalls: 0, toolCalls: 0 });
    } else {
      this.phases.get(name)!.started = true;
    }
  }

  recordPhaseEnd(name: string): void {
    if (this.phases.has(name)) {
      this.phases.get(name)!.completed = true;
    }
  }

  addIssue(severity: VerifyIssue["severity"], phase: string, message: string): void {
    this.issues.push({ severity, phase, message });
  }

  reset(): void {
    this.apiCalls = [];
    this.toolCalls = [];
    this.issues = [];
    this.phases.clear();
    this.startTime = Date.now();
    this.apiSeq = 0;
    this.toolSeq = 0;
  }
}

export const report = new VerifyReportCollector();

// ── 报告输出 ──────────────────────────────────────────────

export async function printVerifyReport(novelDir: string): Promise<void> {
  const elapsed = ((Date.now() - report.startTime) / 1000).toFixed(1);

  console.log("\n");
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║                    验证报告 (Verify Report)                  ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log(`\n⏱  总耗时: ${elapsed}s`);

  // ── 1. 流程完整性 ──
  console.log("\n── 1. 流程完整性 ──────────────────────────────────────────");
  const expectedPhases = ["planning", "analysis", "writing", "verify"];
  for (const phase of expectedPhases) {
    const rec = report.phases.get(phase);
    if (!rec) {
      console.log(`  ⬜ ${phase} — 未触发`);
    } else if (rec.completed) {
      console.log(`  ✅ ${phase} — 完成`);
    } else {
      console.log(`  🟡 ${phase} — 已启动但未完成`);
    }
  }

  // ── 2. API 调用链路 ──
  console.log(`\n── 2. API 调用链路（共 ${report.apiCalls.length} 次）──────────────`);
  for (const call of report.apiCalls) {
    const loopTag = call.isAgentLoop ? (call.isFollowUp ? "🔄" : "🚀") : "📡";
    const toolsTag = call.toolsCalled.length > 0
      ? ` → [${call.toolsCalled.join(", ")}]`
      : "";
    console.log(`  ${loopTag} #${call.seq} ${call.role}/${call.agentType} (${call.responseType})${toolsTag}`);
    console.log(`     system: ${call.systemPromptPreview}`);
  }

  // ── 3. 工具调用记录 ──
  console.log(`\n── 3. 工具调用记录（共 ${report.toolCalls.length} 次）────────────`);
  const toolGroups = new Map<string, number>();
  for (const tc of report.toolCalls) {
    toolGroups.set(tc.toolName, (toolGroups.get(tc.toolName) ?? 0) + 1);
  }
  for (const [name, count] of toolGroups) {
    console.log(`  📦 ${name} × ${count}`);
  }

  // ── 4. 文件产物检查 ──
  console.log("\n── 4. 文件产物检查 ────────────────────────────────────────");
  const expectedFiles = [
    "_outline.md", "_characters.md", "_relationships.md",
    "_chapters.json", "_state.json", "STATE.md",
    "_story_so_far.md", "_todo.json",
  ];
  const optionalFiles = [
    "_foreshadowing.json", "_voice_profiles.md",
    "_handoff_001.md", "_premise.md",
  ];

  const actualFiles = await fs.readdir(novelDir).catch((): string[] => []);

  for (const f of expectedFiles) {
    const exists = actualFiles.includes(f);
    console.log(`  ${exists ? "✅" : "❌"} ${f}`);
    if (!exists) {
      report.addIssue("error", "files", `缺失预期文件: ${f}`);
    }
  }
  for (const f of optionalFiles) {
    const exists = actualFiles.includes(f);
    console.log(`  ${exists ? "✅" : "⬜"} ${f} (可选)`);
  }

  // 检查章节文件
  const chapterFiles = actualFiles.filter((f) => /^\d{3}-/.test(f) && f.endsWith(".md"));
  console.log(`  📖 章节文件: ${chapterFiles.length} 个`);
  for (const cf of chapterFiles) {
    const stat = await fs.stat(path.join(novelDir, cf)).catch(() => null);
    const size = stat ? `${stat.size} bytes` : "读取失败";
    console.log(`     ${cf} (${size})`);
  }

  // ── 5. 问题和警告 ──
  const errors = report.issues.filter((i) => i.severity === "error");
  const warnings = report.issues.filter((i) => i.severity === "warning");
  const infos = report.issues.filter((i) => i.severity === "info");

  console.log(`\n── 5. 问题和警告 ──────────────────────────────────────────`);
  if (errors.length === 0 && warnings.length === 0) {
    console.log("  ✅ 无错误或警告");
  }
  for (const issue of errors) {
    console.log(`  ❌ [${issue.phase}] ${issue.message}`);
  }
  for (const issue of warnings) {
    console.log(`  ⚠️  [${issue.phase}] ${issue.message}`);
  }
  for (const issue of infos) {
    console.log(`  ℹ️  [${issue.phase}] ${issue.message}`);
  }

  // ── 总结 ──
  console.log("\n── 总结 ──────────────────────────────────────────────────");
  const totalPhases = [...report.phases.values()].filter((p) => p.completed).length;
  console.log(`  阶段: ${totalPhases}/${expectedPhases.length} 完成`);
  console.log(`  API 调用: ${report.apiCalls.length} 次`);
  console.log(`  工具调用: ${report.toolCalls.length} 次`);
  console.log(`  文件产物: ${actualFiles.length} 个`);
  console.log(`  错误: ${errors.length} | 警告: ${warnings.length} | 信息: ${infos.length}`);

  const allGood = errors.length === 0;
  console.log(`\n${allGood ? "✅ 验证通过 — 全流程链路完整" : "❌ 验证失败 — 存在错误需要修复"}`);
  console.log("");
}
