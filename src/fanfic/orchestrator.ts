import { runFanficCommand, type FanficCommandOptions } from "./commands.js";
import { loadFanficProjectState } from "./project.js";
import { getNextAllowedAction } from "./state-machine.js";
import type { FanficCommand, FanficProjectState, FanficStatus } from "./types.js";
import { createWorkflowId, type EventSink, type ObservabilityEvent } from "../observability/events.js";

export interface ContinueFanficOptions extends FanficCommandOptions {
  maxSteps?: number;
  eventSink?: EventSink;
}

export interface ContinueFanficResult {
  state: FanficProjectState;
  executedCommands: FanficCommand[];
  nextAction: FanficCommand | null;
  stoppedReason: "awaiting_human" | "no_action" | "max_steps";
}

const HUMAN_GATE_STATUSES = new Set<FanficStatus>([
  "plan_pending_confirm",
  "draft_pending_confirm",
  "rewrite_pending_confirm",
]);

export async function continueFanficProject(
  storyId: string,
  options: ContinueFanficOptions = {},
): Promise<ContinueFanficResult> {
  const maxSteps = options.maxSteps ?? 1;
  const executedCommands: FanficCommand[] = [];
  const workflowStartedAt = Date.now();
  const workflowId = createWorkflowId("fanfic", () => workflowStartedAt);
  let state = await loadFanficProjectState(storyId, options);

  await emit(options.eventSink, baseEvent("workflow_started", workflowId, storyId));

  for (let step = 0; step < maxSteps; step += 1) {
    const nextAction = getNextAllowedAction(state);
    if (!nextAction) {
      return stopWorkflow({
        state,
        executedCommands,
        nextAction,
        stoppedReason: "no_action",
        workflowId,
        storyId,
        workflowStartedAt,
        sink: options.eventSink,
      });
    }
    if (shouldStopForHuman(state.status, nextAction)) {
      return stopWorkflow({
        state,
        executedCommands,
        nextAction,
        stoppedReason: "awaiting_human",
        workflowId,
        storyId,
        workflowStartedAt,
        sink: options.eventSink,
      });
    }

    const fromStatus = state.status;
    const commandStartedAt = Date.now();
    await emit(options.eventSink, {
      ...baseEvent("command_started", workflowId, storyId),
      command: nextAction,
      fromStatus,
    });

    try {
      state = await runFanficCommand(storyId, nextAction, options);
    } catch (error) {
      await emit(options.eventSink, {
        ...baseEvent("command_failed", workflowId, storyId),
        command: nextAction,
        fromStatus,
        durationMs: Date.now() - commandStartedAt,
        ...errorFields(error),
      });
      await emit(options.eventSink, {
        ...baseEvent("workflow_stopped", workflowId, storyId),
        stopReason: "command_failed",
        nextAction,
        durationMs: Date.now() - workflowStartedAt,
      });
      throw error;
    }

    await emit(options.eventSink, {
      ...baseEvent("command_succeeded", workflowId, storyId),
      command: nextAction,
      fromStatus,
      toStatus: state.status,
      durationMs: Date.now() - commandStartedAt,
    });
    executedCommands.push(nextAction);
  }

  return stopWorkflow({
    state,
    executedCommands,
    nextAction: getNextAllowedAction(state),
    stoppedReason: "max_steps",
    workflowId,
    storyId,
    workflowStartedAt,
    sink: options.eventSink,
  });
}

function shouldStopForHuman(status: FanficStatus, nextAction: FanficCommand): boolean {
  return HUMAN_GATE_STATUSES.has(status) || nextAction.startsWith("approve_");
}

interface StopWorkflowInput {
  state: FanficProjectState;
  executedCommands: FanficCommand[];
  nextAction: FanficCommand | null;
  stoppedReason: ContinueFanficResult["stoppedReason"];
  workflowId: string;
  storyId: string;
  workflowStartedAt: number;
  sink?: EventSink;
}

async function stopWorkflow(input: StopWorkflowInput): Promise<ContinueFanficResult> {
  await emit(input.sink, {
    ...baseEvent("workflow_stopped", input.workflowId, input.storyId),
    stopReason: input.stoppedReason,
    nextAction: input.nextAction,
    durationMs: Date.now() - input.workflowStartedAt,
  });
  return {
    state: input.state,
    executedCommands: input.executedCommands,
    nextAction: input.nextAction,
    stoppedReason: input.stoppedReason,
  };
}

function baseEvent(type: ObservabilityEvent["type"], workflowId: string, storyId: string): ObservabilityEvent {
  return {
    type,
    timestamp: new Date().toISOString(),
    workflowId,
    workflow: "fanfic_continue",
    storyId,
  };
}

async function emit(sink: EventSink | undefined, event: ObservabilityEvent): Promise<void> {
  if (!sink) return;
  await sink(event);
}

function errorFields(error: unknown): Pick<ObservabilityEvent, "errorClass" | "errorMessage"> {
  if (error instanceof Error) {
    return { errorClass: error.name, errorMessage: error.message };
  }
  return { errorClass: typeof error, errorMessage: String(error) };
}
