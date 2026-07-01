import { describe, expect, it } from "vitest";
import { parseJsonObjectFromText } from "../src/materials/llm-json.js";

describe("parseJsonObjectFromText", () => {
  it("parses plain, fenced, and prefixed JSON objects", () => {
    expect(parseJsonObjectFromText("{\"ok\":true}")).toEqual({ ok: true });
    expect(parseJsonObjectFromText("```json\n{\"ok\":true}\n```")).toEqual({ ok: true });
    expect(parseJsonObjectFromText("模型输出：{\"ok\":true}\n以上")).toEqual({ ok: true });
  });
});
