export type ObservabilityEventType =
  | "workflow_started"
  | "workflow_stopped"
  | "command_started"
  | "command_succeeded"
  | "command_failed"
  | "review_recorded";

export type ObservabilityCategory =
  | "safety"
  | "task"
  | "efficiency"
  | "stability"
  | "tool"
  | "quality";

export interface ReviewQualityPayload {
  score: number;
  verdict: string;
  dimensions?: Record<string, number>;
  issueSeverities?: string[];
}

export interface ObservabilityEvent {
  type: ObservabilityEventType;
  timestamp: string;
  workflowId: string;
  workflow?: string;
  storyId?: string;
  command?: string;
  fromStatus?: string;
  toStatus?: string;
  nextAction?: string | null;
  stopReason?: string;
  durationMs?: number;
  errorClass?: string;
  errorMessage?: string;
  review?: ReviewQualityPayload;
}

export type EventSink = (event: ObservabilityEvent) => void | Promise<void>;

export function createWorkflowId(prefix = "wf", now = Date.now): string {
  return prefix + "-" + now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}
