import fs from "fs/promises";

import { describe, expect, it } from "vitest";

describe("career capture project files", () => {
  it("defines the confirmation-first project skill", async () => {
    const skill = await fs.readFile(".agents/skills/career-capture/SKILL.md", "utf8");

    expect(skill).toContain("name: career-capture");
    expect(skill).toContain("npm run career -- status");
    expect(skill).toContain("生成 / 跳过 / 稍后 / 合并");
    expect(skill).toContain("未经用户确认，不得创建案例");
    expect(skill).toContain("mark --commit <hash> --status skipped");
    expect(skill).toContain("mark --commit <hash> --status deferred");
    expect(skill).toContain("career-prepare/novel-agent/cases/<case-id>.md");
    expect(skill).toContain("fill every section");
  });

  it("adds repository-level trigger rules", async () => {
    const agents = (await fs.readFile("AGENTS.md", "utf8")).toLowerCase();

    expect(agents).toContain("## career capture");
    expect(agents).toContain("after a successful commit");
    expect(agents).toContain("before beginning a new implementation task");
  });

  it("starts with an empty stable career index", async () => {
    const index = JSON.parse(
      await fs.readFile("career-prepare/novel-agent/index.json", "utf8"),
    );

    expect(index).toEqual({
      schemaVersion: 1,
      project: "novel-agent",
      cases: [],
      decisions: [],
    });
  });
});
