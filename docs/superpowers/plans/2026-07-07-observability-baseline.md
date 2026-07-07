# Observability Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first deployable observability baseline for safety, task completion, efficiency, stability, tool quality, and answer quality.

**Architecture:** Add a small typed event layer under `src/observability`, aggregate events into metric snapshots, and instrument the fanfic orchestrator through an optional event sink. Keep exporters local and dependency-free so the same events can later feed OpenTelemetry, Prometheus, Datadog, or a hosted worker.

**Tech Stack:** TypeScript, Vitest, Node fs/promises, existing fanfic state machine and CLI.

## Global Constraints

- No new runtime dependency for the first baseline.
- Metrics must be generated from structured events, not parsed console output.
- Fanfic instrumentation must be optional and must not change existing workflow behavior when no sink is provided.
- Tests must cover event aggregation, successful command instrumentation, human gate stops, and command failures.
- Local logs must be JSONL so they can be tailed, archived, or batch-imported later.

---

## File Structure

- Create `src/observability/events.ts`: shared event types, event sink type, event factory helpers.
- Create `src/observability/metrics.ts`: pure aggregation from events to counters, timing summaries, and quality summaries.
- Create `src/observability/jsonl-sink.ts`: append-only JSONL sink and log reader for local deployment validation.
- Modify `src/fanfic/orchestrator.ts`: emit workflow and command events through an optional sink.
- Modify `src/fanfic-cli.ts`: optionally write continue metrics to a JSONL path from `FANFIC_METRICS_LOG`.
- Create `tests/observability-metrics.test.ts`: event aggregation tests.
- Modify `tests/fanfic-orchestrator.test.ts`: instrumentation tests for success, human gates, and failure.

### Task 1: Event Model And Metrics Aggregator

**Files:**
- Create: `src/observability/events.ts`
- Create: `src/observability/metrics.ts`
- Test: `tests/observability-metrics.test.ts`

**Interfaces:**
- Produces: `ObservabilityEvent`, `EventSink`, `summarizeObservabilityEvents(events: ObservabilityEvent[]): MetricSnapshot`.
- Consumes: no fanfic-specific code; accepts command/status strings as event fields.

- [ ] Write failing tests for counters, timing summaries, and review quality summaries.
- [ ] Run `npm test -- tests/observability-metrics.test.ts` and confirm module-not-found or missing export failure.
- [ ] Implement minimal event types and aggregator.
- [ ] Re-run the focused test and confirm it passes.

### Task 2: Fanfic Orchestrator Instrumentation

**Files:**
- Modify: `src/fanfic/orchestrator.ts`
- Test: `tests/fanfic-orchestrator.test.ts`

**Interfaces:**
- Consumes: `EventSink` from `src/observability/events.ts`.
- Produces: `ContinueFanficOptions.eventSink?: EventSink` and emitted workflow/command events.

- [ ] Add failing tests that collect emitted events for success, human gate stop, and command failure.
- [ ] Run `npm test -- tests/fanfic-orchestrator.test.ts` and confirm failures point to missing events.
- [ ] Emit `workflow_started`, `command_started`, `command_succeeded`, `command_failed`, and `workflow_stopped` events.
- [ ] Re-run fanfic orchestrator tests and confirm they pass.

### Task 3: Local JSONL Sink And CLI Wiring

**Files:**
- Create: `src/observability/jsonl-sink.ts`
- Modify: `src/fanfic-cli.ts`
- Test: `tests/observability-jsonl-sink.test.ts`

**Interfaces:**
- Produces: `createJsonlEventSink(filePath: string): EventSink` and `readJsonlEvents(filePath: string): Promise<ObservabilityEvent[]>`.
- Consumes: `FANFIC_METRICS_LOG` env var in the fanfic CLI continue command.

- [ ] Write failing JSONL sink tests for append and readback.
- [ ] Implement the JSONL sink.
- [ ] Wire `FANFIC_METRICS_LOG` into `npm run fanfic -- continue`.
- [ ] Run focused tests and typecheck.

### Task 4: Verification

**Files:**
- Existing verification scripts only.

- [ ] Run `npm run check`.
- [ ] Run `npm run build`.
- [ ] Review `git diff --stat` and confirm only planned files changed.

## Self-Review Notes

- Spec coverage: covers all six requested metric areas through categories and first fanfic workflow instrumentation.
- Placeholder scan: no deferred placeholder requirements; future exporter work is explicitly out of this first baseline.
- Type consistency: event sink and aggregation signatures are shared across tasks.
