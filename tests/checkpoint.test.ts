/**
 * checkpoint.test.ts - 检查点机制单测
 *
 * 验证：
 *   - loadCheckpoint: 加载存在/不存在的检查点
 *   - 检查点文件格式正确性
 */

import { describe, it, expect, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import { loadCheckpoint, type Checkpoint } from "../src/agent-loop.js";

const TEST_DIR = path.resolve("novels/_test_checkpoint");
const CHECKPOINT_FILE = path.join(TEST_DIR, "_checkpoint.json");

afterEach(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

describe("loadCheckpoint", () => {
  it("文件不存在时返回 null", async () => {
    const result = await loadCheckpoint(CHECKPOINT_FILE);
    expect(result).toBeNull();
  });

  it("加载有效检查点", async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
    const checkpoint: Checkpoint = {
      messages: [
        { role: "user", content: "请生成大纲" },
        { role: "assistant", content: [{ type: "text", text: "好的" }] },
      ],
      timestamp: "2026-04-05T12:00:00.000Z",
      lastTool: "read_plan",
    };
    await fs.writeFile(CHECKPOINT_FILE, JSON.stringify(checkpoint), "utf-8");

    const result = await loadCheckpoint(CHECKPOINT_FILE);
    expect(result).not.toBeNull();
    expect(result!.messages).toHaveLength(2);
    expect(result!.lastTool).toBe("read_plan");
    expect(result!.timestamp).toBe("2026-04-05T12:00:00.000Z");
  });

  it("无效 JSON 返回 null", async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
    await fs.writeFile(CHECKPOINT_FILE, "not json", "utf-8");

    const result = await loadCheckpoint(CHECKPOINT_FILE);
    expect(result).toBeNull();
  });
});
