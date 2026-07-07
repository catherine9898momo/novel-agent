import { describe, expect, it } from "vitest";
import { summarizeObservabilityEvents } from "../src/observability/metrics.js";
import type { ObservabilityEvent } from "../src/observability/events.js";

const base = {
  timestamp: "2026-07-07T00:00:00.000Z",
  workflowId: "wf-1",
  workflow: "fanfic_continue",
  storyId: "rain-letter",
} as const;

describe("observability metrics aggregation", () => {
  it("aggregates task, safety, tool, and latency metrics from workflow events", () => {
    const events: ObservabilityEvent[] = [
      { ...base, type: "workflow_started" },
      { ...base, type: "command_started", command: "parse_idea", fromStatus: "idea_pending_confirm" },
      { ...base, type: "command_succeeded", command: "parse_idea", fromStatus: "idea_pending_confirm", toStatus: "idea_pending_confirm", durationMs: 42 },
      { ...base, type: "workflow_stopped", stopReason: "awaiting_human", nextAction: "approve_idea", durationMs: 55 },
    ];

    const snapshot = summarizeObservabilityEvents(events);

    expect(snapshot.counters["task.workflow_started_count"]).toBe(1);
    expect(snapshot.counters["task.workflow_stopped_count"]).toBe(1);
    expect(snapshot.counters["task.command_started_count"]).toBe(1);
    expect(snapshot.counters["task.command_succeeded_count"]).toBe(1);
    expect(snapshot.counters["task.stop_reason.awaiting_human_count"]).toBe(1);
    expect(snapshot.counters["safety.human_gate_stop_count"]).toBe(1);
    expect(snapshot.counters["tool.command_success.parse_idea_count"]).toBe(1);
    expect(snapshot.timings["latency.command_ms.parse_idea"]).toMatchObject({ count: 1, totalMs: 42, avgMs: 42, minMs: 42, maxMs: 42 });
    expect(snapshot.timings["latency.workflow_ms.fanfic_continue"]).toMatchObject({ count: 1, totalMs: 55, avgMs: 55, minMs: 55, maxMs: 55 });
  });

  it("aggregates command failures into stability and safety metrics", () => {
    const events: ObservabilityEvent[] = [
      { ...base, type: "command_started", command: "generate_plan", fromStatus: "idea_confirmed" },
      { ...base, type: "command_failed", command: "generate_plan", fromStatus: "idea_confirmed", durationMs: 12, errorClass: "Error", errorMessage: "model unavailable" },
    ];

    const snapshot = summarizeObservabilityEvents(events);

    expect(snapshot.counters["task.command_failed_count"]).toBe(1);
    expect(snapshot.counters["stability.command_failure_count"]).toBe(1);
    expect(snapshot.counters["safety.error_by_command.generate_plan_count"]).toBe(1);
    expect(snapshot.counters["tool.command_failure.generate_plan_count"]).toBe(1);
    expect(snapshot.timings["latency.command_ms.generate_plan"]).toMatchObject({ count: 1, totalMs: 12, avgMs: 12 });
  });

  it("aggregates review scores, verdicts, dimensions, and issue severity", () => {
    const events: ObservabilityEvent[] = [
      {
        ...base,
        type: "review_recorded",
        command: "run_review",
        review: {
          score: 8,
          verdict: "needs_rewrite",
          dimensions: {
            canonFit: 4,
            requiredSceneCoverage: 5,
            avoidListSafety: 5,
            proseQuality: 3,
            relationshipTension: 4,
            pacing: 4,
          },
          issueSeverities: ["minor", "critical"],
        },
      },
    ];

    const snapshot = summarizeObservabilityEvents(events);

    expect(snapshot.counters["quality.review_recorded_count"]).toBe(1);
    expect(snapshot.counters["quality.review_verdict.needs_rewrite_count"]).toBe(1);
    expect(snapshot.counters["quality.issue_severity.minor_count"]).toBe(1);
    expect(snapshot.counters["quality.issue_severity.critical_count"]).toBe(1);
    expect(snapshot.quality.reviewScore).toMatchObject({ count: 1, avg: 8, min: 8, max: 8 });
    expect(snapshot.quality.dimensionScores.proseQuality).toMatchObject({ count: 1, avg: 3, min: 3, max: 3 });
  });
});
