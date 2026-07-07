import { afterEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import path from "path";
import { createEventSinkFromEnv } from "../src/observability/env.js";
import { readJsonlEvents } from "../src/observability/jsonl-sink.js";

const ROOT = path.resolve("fanfics/_test_observability_env");
const LOG = path.join(ROOT, "fanfic-events.jsonl");

afterEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
});

describe("observability env sink factory", () => {
  it("returns undefined when the log env var is absent", () => {
    expect(createEventSinkFromEnv({})).toBeUndefined();
  });

  it("returns a JSONL sink for FANFIC_METRICS_LOG", async () => {
    const sink = createEventSinkFromEnv({ FANFIC_METRICS_LOG: LOG });
    expect(sink).toBeDefined();

    await sink?.({
      type: "workflow_started",
      timestamp: "2026-07-07T00:00:00.000Z",
      workflowId: "wf-env",
      workflow: "fanfic_continue",
      storyId: "rain-letter",
    });

    const events = await readJsonlEvents(LOG);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ workflowId: "wf-env", storyId: "rain-letter" });
  });
});
