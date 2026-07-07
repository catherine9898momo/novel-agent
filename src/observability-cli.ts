import { readJsonlEvents } from "./observability/jsonl-sink.js";
import { summarizeObservabilityEvents } from "./observability/metrics.js";

const [logPath] = process.argv.slice(2);

if (!logPath) {
  console.log("用法: npm run metrics:events -- <events.jsonl>");
  process.exit(0);
}

async function main(): Promise<void> {
  const events = await readJsonlEvents(logPath);
  const snapshot = summarizeObservabilityEvents(events);
  console.log(JSON.stringify(snapshot, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
