import fs from "fs/promises";
import path from "path";
import type { EventSink, ObservabilityEvent } from "./events.js";

export function createJsonlEventSink(filePath: string): EventSink {
  return async (event: ObservabilityEvent): Promise<void> => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, JSON.stringify(event) + "\n", "utf-8");
  };
}

export async function readJsonlEvents(filePath: string): Promise<ObservabilityEvent[]> {
  const raw = await fs.readFile(filePath, "utf-8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ObservabilityEvent);
}
