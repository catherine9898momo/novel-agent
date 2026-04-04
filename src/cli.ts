/**
 * cli.ts - 共享 CLI 工具函数
 *
 * 在 VERIFY_MODE 下自动响应所有 HITL 提示，
 * 使得验证流水线可以无人值守地跑完全流程。
 */

import * as readline from "readline";

/**
 * askLine - 读取用户输入（VERIFY_MODE 下自动响应）
 *
 * 自动响应策略：
 *   - 默认回复 "y"（确认通过）
 *   - 含"处理方式"→ "1"（补写缺失章节）
 *   - 含"Enter"→ ""（按回车继续）
 *   - 含"序号"→ "1"（选择第一项）
 */
export function askLine(prompt: string): Promise<string> {
  if (process.env.VERIFY_MODE) {
    let response = "y";
    if (prompt.includes("处理方式")) response = "1";
    if (prompt.includes("Enter")) response = "";
    if (prompt.includes("序号")) response = "1";
    console.log(`${prompt}[verify-auto: ${response || "↵"}]`);
    return Promise.resolve(response);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
