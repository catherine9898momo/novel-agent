import { describe, expect, it } from "vitest";
import fs from "fs";

const html = fs.readFileSync("docs/fanfic-idea-workspace.html", "utf-8");
const script = html.slice(html.indexOf("<script>"), html.indexOf("</script>"));

describe("fanfic UI HTML interactions", () => {
  it("退回修改会开启可重新解析的新会话", () => {
    expect(script).toContain("startRevisionSession");
    expect(script).toMatch(/function reviseIdea\(\) \{\s*startRevisionSession\(\);\s*\}/);
    expect(script).not.toContain("请在左侧修改创意后开启新会话");
  });

  it("LLM 请求执行中显示按钮和故事卡 loading 状态", () => {
    expect(script).toContain("buttonBusyLabels");
    expect(script).toContain("解析中");
    expect(script).toContain("renderStoryCardLoading");
    expect(html).toContain("@keyframes spin");
  });

  it("支持故事卡单点弹窗修改并写回本地 API", () => {
    expect(html).toContain('id="storyCardEditDialog"');
    expect(html).toContain('data-edit-target="idea"');
    expect(html).toContain('data-edit-target="canon"');
    expect(script).toContain("openStoryCardEditDialog");
    expect(script).toContain("/api/fanfic/story-card");
    expect(script).toContain("saveStoryCardEdit");
  });
});
