import path from "path";
import { fileURLToPath } from "url";
import { createFanficPreviewServer } from "../src/fanfic/local-http-server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const docsDir = path.join(root, "docs");
const entry = "fanfic-idea-workspace.html";
const preferredPort = Number(process.env.PORT ?? 4173);
const fanficRoot = process.env.FANFIC_ROOT ?? path.join(root, "fanfics-ui-local");

async function listen(port: number): Promise<{ port: number }> {
  const server = createFanficPreviewServer({ docsDir, entry, rootDir: fanficRoot });
  return await new Promise((resolve, reject) => {
    server.once("error", async (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE" && port < preferredPort + 20) {
        try {
          resolve(await listen(port + 1));
        } catch (nextError) {
          reject(nextError);
        }
        return;
      }
      reject(error);
    });

    server.listen(port, "127.0.0.1", () => {
      resolve({ port });
    });
  });
}

async function main(): Promise<void> {
  const result = await listen(preferredPort);
  const url = "http://127.0.0.1:" + result.port + "/";
  console.log("Fanfic UI preview: " + url);
  console.log("Serving: docs/" + entry);
  console.log("Fanfic root: " + fanficRoot);
  console.log("API: /api/fanfic/session, /api/fanfic/continue, /api/fanfic/action, and /api/fanfic/story-card");
  console.log("Press Ctrl+C to stop.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
