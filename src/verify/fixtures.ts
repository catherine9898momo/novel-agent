/**
 * verify/fixtures.ts - 验证模式测试夹具
 *
 * 创建一个最小化的测试小说目录，用于驱动全流程验证。
 * 验证完成后可选择清理。
 */

import fs from "fs/promises";
import path from "path";

export const VERIFY_NOVEL_TITLE = "_verify_test";
export const VERIFY_NOVEL_DIR = path.resolve("novels", VERIFY_NOVEL_TITLE);

/**
 * 创建干净的测试目录（删除旧的如果存在）
 */
export async function setupFixtures(): Promise<void> {
  // 清理旧测试目录
  await fs.rm(VERIFY_NOVEL_DIR, { recursive: true, force: true });
  await fs.mkdir(VERIFY_NOVEL_DIR, { recursive: true });

  // 写入故事前提（可选文件，验证 orchestrator 是否正确加载）
  await fs.writeFile(
    path.join(VERIFY_NOVEL_DIR, "_premise.md"),
    `# 故事前提

[verify-fixture] 北境将军之女沈清辞被迫入京和亲，
嫁予当朝太子萧衍。宫廷暗流涌动，二人从对立到相知。`,
    "utf-8",
  );

  console.log(`[fixtures] 已创建测试目录: ${VERIFY_NOVEL_DIR}`);
}

/**
 * 清理测试目录
 */
export async function cleanupFixtures(): Promise<void> {
  await fs.rm(VERIFY_NOVEL_DIR, { recursive: true, force: true });
  console.log(`[fixtures] 已清理测试目录: ${VERIFY_NOVEL_DIR}`);
}

/**
 * 列出测试目录中所有生成的文件
 */
export async function listGeneratedFiles(): Promise<string[]> {
  return await fs.readdir(VERIFY_NOVEL_DIR).catch((): string[] => []);
}
