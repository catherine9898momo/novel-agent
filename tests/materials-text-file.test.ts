import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import { readNovelTextFile } from "../src/materials/text-file.js";

const ROOT = path.resolve("materials/_test_text_files");

beforeEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
  await fs.mkdir(ROOT, { recursive: true });
});

afterEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
});

describe("readNovelTextFile", () => {
  it("reads utf-8 text files", async () => {
    const filePath = path.join(ROOT, "utf8.txt");
    await fs.writeFile(filePath, "第一章 旧信\n沈清辞回头。", "utf-8");

    await expect(readNovelTextFile(filePath)).resolves.toContain("沈清辞");
  });

  it("reads utf-16le text files with many null bytes", async () => {
    const filePath = path.join(ROOT, "utf16le.txt");
    await fs.writeFile(filePath, Buffer.from("1.  觉   她醒了。\n正文开始。", "utf16le"));

    const text = await readNovelTextFile(filePath);

    expect(text).toContain("她醒了");
    expect(text).not.toContain("\u0000");
  });
});
