import type { EventSink } from "./events.js";
import { createJsonlEventSink } from "./jsonl-sink.js";

export function createEventSinkFromEnv(
  env: Record<string, string | undefined>,
  key = "FANFIC_METRICS_LOG",
): EventSink | undefined {
  const filePath = env[key]?.trim();
  if (!filePath) return undefined;
  return createJsonlEventSink(filePath);
}
