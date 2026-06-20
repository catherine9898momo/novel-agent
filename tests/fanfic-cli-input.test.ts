import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import { readFanficIdeaInput } from "../src/fanfic/cli-input.js";

const ROOT = path.resolve("fanfics/_test_phase2_cli_input");

beforeEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
  await fs.mkdir(ROOT, { recursive: true });
});

afterEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
});

describe("fanfic CLI idea input", () => {
  it("reads long-form idea text from --idea-file", async () => {
    const file = path.join(ROOT, "idea.txt");
    await fs.writeFile(file, "雨夜旧信\n长廊雨声", "utf-8");

    await expect(readFanficIdeaInput(["--idea-file", file])).resolves.toBe("雨夜旧信\n长廊雨声");
  });

  it("reads short idea text from --idea", async () => {
    await expect(readFanficIdeaInput(["--idea", "想写一封旧信"])).resolves.toBe("想写一封旧信");
  });

  it("rejects ambiguous or missing idea input", async () => {
    const file = path.join(ROOT, "idea.txt");
    await fs.writeFile(file, "雨夜旧信", "utf-8");

    await expect(readFanficIdeaInput(["--idea", "短文本", "--idea-file", file]))
      .rejects.toThrow(/choose either --idea or --idea-file/i);
    await expect(readFanficIdeaInput([]))
      .rejects.toThrow(/parse_idea requires --idea or --idea-file/i);
  });
});
