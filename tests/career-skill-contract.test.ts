import fs from "fs/promises";

import { describe, expect, it } from "vitest";

describe("career capture content contract", () => {
  it("keeps every evidence section in the case template", async () => {
    const template = await fs.readFile(
      ".agents/skills/career-capture/references/case-template.md",
      "utf8",
    );
    const headings = [
      "## 一句话背景",
      "## 遇到的困难",
      "## 为什么这是 Agent 工程问题",
      "## 约束与失败模式",
      "## 方案比较",
      "## 最终决策",
      "## 关键实现",
      "## 测试与证据",
      "## 最终效果",
      "### 已验证",
      "### 尚未验证",
      "### 下一步测量",
      "## 设计取舍与遗留问题",
      "## 面试知识点",
      "## 追问与回答要点",
      "## 60 秒回答",
      "## 3 分钟回答",
    ];

    for (const heading of headings) {
      expect(template).toContain(heading);
    }
  });

  it("defines every stable interview topic slug", async () => {
    const taxonomy = await fs.readFile(
      ".agents/skills/career-capture/references/interview-topic-taxonomy.md",
      "utf8",
    );
    const slugs = [
      "orchestration",
      "state-machine",
      "context-engineering",
      "memory",
      "tool-use",
      "human-in-the-loop",
      "evaluation",
      "observability",
      "reliability",
      "security",
      "model-routing",
      "testing",
    ];

    for (const slug of slugs) {
      expect(taxonomy).toContain(`\`${slug}\``);
    }
  });
});
