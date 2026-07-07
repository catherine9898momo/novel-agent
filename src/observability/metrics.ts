import type { ObservabilityEvent } from "./events.js";

export interface TimingSummary {
  count: number;
  totalMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
}

export interface NumericSummary {
  count: number;
  total: number;
  avg: number;
  min: number;
  max: number;
}

export interface QualityMetricSummary {
  reviewScore: NumericSummary;
  dimensionScores: Record<string, NumericSummary>;
}

export interface MetricSnapshot {
  counters: Record<string, number>;
  timings: Record<string, TimingSummary>;
  quality: QualityMetricSummary;
}

interface MutableTiming {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
}

interface MutableNumber {
  count: number;
  total: number;
  min: number;
  max: number;
}

export function summarizeObservabilityEvents(events: ObservabilityEvent[]): MetricSnapshot {
  const counters: Record<string, number> = {};
  const timings: Record<string, MutableTiming> = {};
  const reviewScore = createMutableNumber();
  const dimensionScores: Record<string, MutableNumber> = {};

  for (const event of events) {
    switch (event.type) {
      case "workflow_started":
        increment(counters, "task.workflow_started_count");
        break;
      case "workflow_stopped":
        increment(counters, "task.workflow_stopped_count");
        if (event.stopReason) increment(counters, "task.stop_reason." + event.stopReason + "_count");
        if (event.stopReason === "awaiting_human") increment(counters, "safety.human_gate_stop_count");
        recordTiming(timings, "latency.workflow_ms." + (event.workflow ?? "unknown"), event.durationMs);
        break;
      case "command_started":
        increment(counters, "task.command_started_count");
        break;
      case "command_succeeded":
        increment(counters, "task.command_succeeded_count");
        increment(counters, "tool.command_success." + (event.command ?? "unknown") + "_count");
        recordTiming(timings, "latency.command_ms." + (event.command ?? "unknown"), event.durationMs);
        break;
      case "command_failed":
        increment(counters, "task.command_failed_count");
        increment(counters, "stability.command_failure_count");
        increment(counters, "safety.error_by_command." + (event.command ?? "unknown") + "_count");
        increment(counters, "tool.command_failure." + (event.command ?? "unknown") + "_count");
        recordTiming(timings, "latency.command_ms." + (event.command ?? "unknown"), event.durationMs);
        break;
      case "review_recorded":
        increment(counters, "quality.review_recorded_count");
        if (event.review) {
          increment(counters, "quality.review_verdict." + event.review.verdict + "_count");
          recordNumber(reviewScore, event.review.score);
          for (const severity of event.review.issueSeverities ?? []) {
            increment(counters, "quality.issue_severity." + severity + "_count");
          }
          for (const [dimension, score] of Object.entries(event.review.dimensions ?? {})) {
            const summary = dimensionScores[dimension] ?? createMutableNumber();
            recordNumber(summary, score);
            dimensionScores[dimension] = summary;
          }
        }
        break;
    }
  }

  return {
    counters,
    timings: finalizeTimings(timings),
    quality: {
      reviewScore: finalizeNumber(reviewScore),
      dimensionScores: finalizeNumbers(dimensionScores),
    },
  };
}

function increment(counters: Record<string, number>, key: string): void {
  counters[key] = (counters[key] ?? 0) + 1;
}

function recordTiming(timings: Record<string, MutableTiming>, key: string, value: number | undefined): void {
  if (typeof value !== "number" || !Number.isFinite(value)) return;
  const timing = timings[key] ?? { count: 0, totalMs: 0, minMs: value, maxMs: value };
  timing.count += 1;
  timing.totalMs += value;
  timing.minMs = Math.min(timing.minMs, value);
  timing.maxMs = Math.max(timing.maxMs, value);
  timings[key] = timing;
}

function finalizeTimings(timings: Record<string, MutableTiming>): Record<string, TimingSummary> {
  return Object.fromEntries(Object.entries(timings).map(([key, value]) => [key, {
    count: value.count,
    totalMs: value.totalMs,
    avgMs: value.count === 0 ? 0 : value.totalMs / value.count,
    minMs: value.count === 0 ? 0 : value.minMs,
    maxMs: value.count === 0 ? 0 : value.maxMs,
  }]));
}

function createMutableNumber(): MutableNumber {
  return { count: 0, total: 0, min: 0, max: 0 };
}

function recordNumber(summary: MutableNumber, value: number): void {
  if (!Number.isFinite(value)) return;
  if (summary.count === 0) {
    summary.min = value;
    summary.max = value;
  } else {
    summary.min = Math.min(summary.min, value);
    summary.max = Math.max(summary.max, value);
  }
  summary.count += 1;
  summary.total += value;
}

function finalizeNumber(summary: MutableNumber): NumericSummary {
  return {
    count: summary.count,
    total: summary.total,
    avg: summary.count === 0 ? 0 : summary.total / summary.count,
    min: summary.count === 0 ? 0 : summary.min,
    max: summary.count === 0 ? 0 : summary.max,
  };
}

function finalizeNumbers(values: Record<string, MutableNumber>): Record<string, NumericSummary> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, finalizeNumber(value)]));
}
