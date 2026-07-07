import { afterEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import path from "path";
import { createJsonlEventSink, readJsonlEvents } from "../src/observability/jsonl-sink.js";
import type { ObservabilityEvent } from "../src/observability/events.js";

const ROOT = path.resolve("fanfics/_test_observability_jsonl");
const LOG = path.join(ROOT, "events.jsonl");

afterEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
});

describe("JSONL observability sink", () => {
  it("appends events and reads them back in order", async () => {
    const sink = createJsonlEventSink(LOG);
    const events: ObservabilityEvent[] = [
      { type: "workflow_started", timestamp: "2026-07-07T00:00:00.000Z", workflowId: "wf-1", workflow: "fanfic_continue", storyId: "rain-letter" },
      { type: "workflow_stopped", timestamp: "2026-07-07T00:00:01.000Z", workflowId: "wf-1", workflow: "fanfic_continue", storyId: "rain-letter", stopReason: "awaiting_human", durationMs: 1000 },
    ];

    await sink(events[0]);
    await sink(events[1]);

    await expect(fs.stat(LOG)).resolves.toBeTruthy();
    await expect(readJsonlEvents(LOG)).resolves.toEqual(events);
  });

  it("returns an empty event list when the log file does not exist", async () => {
    await expect(readJsonlEvents(LOG)).resolves.toEqual([]);
  });
});
