/**
 * novel-state.test.ts - 状态管理单测
 *
 * 验证 NovelState 类的核心能力：
 *   - load: 新建 / 从文件恢复
 *   - phase: 阶段切换
 *   - decisions: 决策记录与查询
 *   - stats: 写作统计更新
 *   - session: 会话管理（start/pause/resume）
 *   - planning: 规划完成度标记
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import { NovelState } from "../src/novel-state.js";

const TEST_DIR = path.resolve("novels/_test_state_novel");

beforeEach(async () => {
  await fs.mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

describe("NovelState.load", () => {
  it("新建状态：无文件时创建默认状态", async () => {
    const state = await NovelState.load(TEST_DIR, "测试小说", "ancient-romance");
    expect(state.phase).toBe("init");
    expect(state.chapter).toBeNull();
    expect(state.data.novelTitle).toBe("测试小说");

    // 应该已持久化
    const raw = await fs.readFile(path.join(TEST_DIR, "_state.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.novelTitle).toBe("测试小说");
  });

  it("恢复状态：从已有文件加载", async () => {
    const state1 = await NovelState.load(TEST_DIR, "测试小说", "ancient-romance");
    await state1.setPhase("writing");
    await state1.setCurrentChapter(3);

    // 重新加载
    const state2 = await NovelState.load(TEST_DIR, "测试小说", "ancient-romance");
    expect(state2.phase).toBe("writing");
    expect(state2.chapter).toBe(3);
  });
});

describe("phase management", () => {
  it("切换阶段并持久化", async () => {
    const state = await NovelState.load(TEST_DIR, "测试", "test");
    await state.setPhase("planning");
    expect(state.phase).toBe("planning");

    await state.setPhase("writing");
    expect(state.phase).toBe("writing");

    // 重新加载验证
    const state2 = await NovelState.load(TEST_DIR, "测试", "test");
    expect(state2.phase).toBe("writing");
  });
});

describe("decisions", () => {
  it("添加决策并按阶段查询", async () => {
    const state = await NovelState.load(TEST_DIR, "测试", "test");
    await state.addDecision("planning", "outline", "同意大纲");
    await state.addDecision("planning", "characters", "女主需要更强");
    await state.addDecision("writing", "chapter-1", "需要重写");

    expect(state.getDecisions().length).toBe(3);
    expect(state.getDecisions("planning").length).toBe(2);
    expect(state.getDecisions("writing").length).toBe(1);
    expect(state.getDecisions("writing")[0].choice).toBe("需要重写");
  });

  it("决策持久化", async () => {
    const state1 = await NovelState.load(TEST_DIR, "测试", "test");
    await state1.addDecision("planning", "outline", "好的", "用户确认");

    const state2 = await NovelState.load(TEST_DIR, "测试", "test");
    expect(state2.getDecisions().length).toBe(1);
    expect(state2.getDecisions()[0].context).toBe("用户确认");
  });
});

describe("planning completion", () => {
  it("标记规划完成", async () => {
    const state = await NovelState.load(TEST_DIR, "测试", "test");
    expect(state.data.planningComplete.outline).toBe(false);

    await state.markPlanningDone("outline");
    expect(state.data.planningComplete.outline).toBe(true);

    await state.markPlanningDone("characters");
    expect(state.data.planningComplete.characters).toBe(true);
    expect(state.data.planningComplete.relationships).toBe(false);
  });
});

describe("session management", () => {
  it("开始和暂停会话", async () => {
    const state = await NovelState.load(TEST_DIR, "测试", "test");
    await state.startSession();
    expect(state.data.currentSession).not.toBeNull();

    await state.addAccomplishment("完成大纲");
    await state.addAccomplishment("完成人物");
    expect(state.data.currentSession!.accomplishments).toHaveLength(2);

    await state.pauseSession(["继续写第1章"]);
    expect(state.data.currentSession).toBeNull();
    expect(state.data.sessions).toHaveLength(1);

    const last = state.getLastSession();
    expect(last!.accomplishments).toEqual(["完成大纲", "完成人物"]);
    expect(last!.nextSteps).toEqual(["继续写第1章"]);
  });
});

describe("stats", () => {
  it("更新写作统计", async () => {
    const state = await NovelState.load(TEST_DIR, "测试", "test");
    await state.updateStats({ totalWords: 5000, chaptersCompleted: 2, chaptersTotal: 10 });
    expect(state.data.stats.totalWords).toBe(5000);
    expect(state.data.stats.chaptersCompleted).toBe(2);

    // 部分更新不覆盖其他字段
    await state.updateStats({ totalWords: 8000 });
    expect(state.data.stats.totalWords).toBe(8000);
    expect(state.data.stats.chaptersCompleted).toBe(2);
  });
});

describe("open questions", () => {
  it("添加和解决问题", async () => {
    const state = await NovelState.load(TEST_DIR, "测试", "test");
    await state.addOpenQuestion("女主武功水平？");
    await state.addOpenQuestion("男主身世揭露时机？");
    expect(state.data.openQuestions).toHaveLength(2);

    await state.resolveQuestion("女主武功水平？");
    expect(state.data.openQuestions).toHaveLength(1);
    expect(state.data.openQuestions[0]).toBe("男主身世揭露时机？");
  });
});
