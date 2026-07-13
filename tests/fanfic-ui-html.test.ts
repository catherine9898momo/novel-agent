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

  it("执行结束后会重新渲染 workflow，避免状态停在执行中", () => {
    expect(script).toMatch(/if \(!value\) \{[\s\S]*?renderWorkflow\(\);[\s\S]*?\}/);
  });

  it("snapshot 应只渲染当前可见阶段，避免长正文反复重排", () => {
    expect(script).toContain("renderVisibleStageContent");
    const applySnapshotBody = script.match(/function applySnapshot\(nextSnapshot\) \{([\s\S]*?)\n    \}/)?.[1] ?? "";
    expect(applySnapshotBody).not.toContain("renderDraft();");
    expect(applySnapshotBody).not.toContain("renderFinal();");
  });

  it("终稿长文本不使用 content-visibility 懒绘制，避免快速滚动白屏", () => {
    expect(html).not.toContain("content-visibility: auto");
    expect(html).not.toContain("contain-intrinsic-size");
    expect(html).toContain("finalDoc");
    expect(html).toContain("overflow: auto");
  });

  it("产物页使用窄摘要宽正文布局，提高终稿阅读空间利用率", () => {
    expect(html).toContain("artifact-content-grid");
    expect(html).toContain("grid-template-columns: minmax(220px, 320px) minmax(0, 1fr)");
    expect(html).toContain("final-document");
  });

  it("提供继续创作入口并调用 continue API", () => {
    expect(html).toContain('id="continueBtn"');
    expect(script).toContain('continue: "/api/fanfic/continue"');
    expect(script).toContain("async function continueCreation");
    expect(script).toContain("maxSteps: 8");
  });

  it("展示运行中、本轮步骤、停止原因和下一动作", () => {
    expect(html).toContain('id="runSummary"');
    expect(html).toContain('id="executedCommands"');
    expect(html).toContain('id="nextActionText"');
    expect(script).toContain("renderContinueResult");
    expect(script).toContain("等待人工确认");
    expect(script).toContain("没有可执行动作");
    expect(script).toContain("达到最大执行步数");
    expect(script).toContain("命令执行失败");
  });

  it("继续创作不会从前端自动发送审批命令", () => {
    const continueBody = script.match(/async function continueCreation\(\) \{([\s\S]*?)\n    \}/)?.[1] ?? "";
    expect(continueBody).toContain("API.continue");
    expect(continueBody).not.toContain("approve_");
    expect(continueBody).not.toContain("runAction");
  });

  it("刷新恢复项目状态时重置仅属于上一轮的运行摘要", () => {
    const startSessionBody = script.match(/async function startSession\([\s\S]*?\) \{([\s\S]*?)\n    \}/)?.[1] ?? "";
    expect(startSessionBody).toContain("continueResult = null");
    expect(startSessionBody).toContain("applySnapshot(snapshot)");
  });

  it("页面脚本保持可编译", () => {
    expect(() => new Function(script.replace("<script>", ""))).not.toThrow();
  });
});
