import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import http from "http";
import path from "path";
import { createFanficPreviewServer } from "../src/fanfic/local-http-server.js";
import type { ParsedFanficIdea } from "../src/fanfic/idea-parser.js";
import type { FanficShortPlan } from "../src/fanfic/short-planner.js";

const ROOT = path.resolve("fanfics/_test_local_http");
const DOCS_DIR = path.resolve("docs");

const parsedIdea: ParsedFanficIdea = {
  idea: {
    source: "示例恋歌",
    relationship: "沈知晚 x 陆承舟",
    timeline: "第二季结尾后",
    divergence: "离开前一晚",
    tropes: ["旧信"],
    dislikes: ["突然告白"],
    rating: "清水",
    targetWordCount: 100,
    ending: "开放式 HE",
    requiredScenes: ["旧信"],
    summary: "雨夜旧信。",
    rawIdea: "原始创意",
  },
  canon: {
    source: "示例恋歌",
    constraints: ["克制"],
    characterNotes: ["敏锐"],
    timelineNotes: ["一晚"],
    risks: ["不要突然告白"],
    rawIdea: "原始创意",
  },
};

const plan: FanficShortPlan = {
  title: "旧信",
  logline: "旧信被发现。",
  premise: "旧信让两人靠近。",
  emotionalArc: { from: "试探", to: "确认", turningPoint: "旧信" },
  scenes: [
    { order: 1, title: "一", purpose: "起", wordBudget: 25, beats: ["旧信", "雨声"], requiredScenes: ["旧信"], canonConstraints: ["克制"], emotionalTurn: "试探" },
    { order: 2, title: "二", purpose: "承", wordBudget: 25, beats: ["相遇", "沉默"], requiredScenes: [], canonConstraints: ["克制"], emotionalTurn: "靠近" },
    { order: 3, title: "三", purpose: "转", wordBudget: 25, beats: ["共伞", "让步"], requiredScenes: [], canonConstraints: ["克制"], emotionalTurn: "确认" },
    { order: 4, title: "四", purpose: "合", wordBudget: 25, beats: ["放回", "离别"], requiredScenes: [], canonConstraints: ["克制"], emotionalTurn: "余味" },
  ],
  requiredSceneCoverage: [{ requiredScene: "旧信", sceneTitle: "一" }],
  avoidChecks: ["避免突然告白"],
  endingStrategy: "开放式 HE",
  writerNotes: ["含蓄"],
};

beforeEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
});

afterEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
});

describe("fanfic local preview HTTP server", () => {
  it("serves the UI and executes fanfic API actions", async () => {
    const server = createFanficPreviewServer({
      docsDir: DOCS_DIR,
      entry: "fanfic-idea-workspace.html",
      rootDir: ROOT,
      commandOptions: {
        ideaParser: async () => parsedIdea,
        planPlanner: async () => plan,
      },
    });
    const baseUrl = await listen(server);
    try {
      const html = await request(baseUrl, "GET", "/");
      expect(html.status).toBe(200);
      expect(html.text).toContain("同人短篇工作台");

      const session = await request(baseUrl, "POST", "/api/fanfic/session", { storyId: "http-rain" });
      expect(session.status).toBe(200);
      expect(session.json.snapshot.state.status).toBe("idea_pending_confirm");

      const parsed = await request(baseUrl, "POST", "/api/fanfic/action", {
        storyId: "http-rain",
        command: "parse_idea",
        ideaText: "原始创意",
      });
      expect(parsed.status).toBe(200);
      expect(parsed.json.snapshot.nextAction).toBe("approve_idea");
      expect(parsed.json.snapshot.artifacts.idea.content.source).toBe("示例恋歌");

      const patched = await request(baseUrl, "POST", "/api/fanfic/story-card", {
        storyId: "http-rain",
        target: "idea",
        field: "summary",
        value: "用户单点修正后的核心故事",
      });
      expect(patched.status).toBe(200);
      expect(patched.json.snapshot.artifacts.idea.content.summary).toBe("用户单点修正后的核心故事");
    } finally {
      await close(server);
    }
  });
});

function listen(server: http.Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") reject(new Error("missing address"));
      else resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function request(baseUrl: string, method: string, pathName: string, body?: unknown): Promise<{ status: number; text: string; json: any }> {
  const response = await fetch(baseUrl + pathName, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  return { status: response.status, text, json: contentType.includes("application/json") && text ? JSON.parse(text) : null };
}
