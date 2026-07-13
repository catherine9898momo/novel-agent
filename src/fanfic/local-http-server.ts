import fs from "fs/promises";
import http from "http";
import path from "path";
import { createFanficUiSnapshot, initFanficUiSession, patchFanficUiStoryCard, runFanficUiAction } from "./local-adapter.js";
import { continueFanficProject } from "./orchestrator.js";
import type { FanficCommandOptions } from "./commands.js";
import type { FanficCommand, FanficProjectOptions } from "./types.js";

export interface FanficPreviewServerOptions extends FanficProjectOptions {
  docsDir: string;
  entry: string;
  commandOptions?: Omit<FanficCommandOptions, "rootDir" | "ideaText">;
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

export function createFanficPreviewServer(options: FanficPreviewServerOptions): http.Server {
  return http.createServer(async (req, res) => {
    try {
      if (!req.url) {
        sendText(res, 400, "Missing URL");
        return;
      }

      const url = new URL(req.url, "http://127.0.0.1");
      if (url.pathname.startsWith("/api/fanfic/")) {
        await handleApi(req, res, url, options);
        return;
      }

      if (req.method !== "GET" && req.method !== "HEAD") {
        sendText(res, 405, "Method not allowed");
        return;
      }
      await serveStatic(req, res, url, options);
    } catch (error) {
      sendJson(res, statusForError(error), { ok: false, error: messageForError(error) });
    }
  });
}

async function handleApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  options: FanficPreviewServerOptions,
): Promise<void> {
  if (url.pathname === "/api/fanfic/session") {
    if (req.method === "GET") {
      const storyId = url.searchParams.get("storyId") ?? "ui-workspace";
      const snapshot = await initFanficUiSession(storyId, options);
      sendJson(res, 200, { ok: true, snapshot });
      return;
    }
    if (req.method === "POST") {
      const body = await readJsonBody(req);
      const storyId = readStoryId(body);
      const snapshot = await initFanficUiSession(storyId, options);
      sendJson(res, 200, { ok: true, snapshot });
      return;
    }
  }

  if (url.pathname === "/api/fanfic/continue" && req.method === "POST") {
    const body = await readJsonBody(req);
    const storyId = readStoryId(body);
    const maxSteps = readMaxSteps(body);
    const ideaText = typeof body.ideaText === "string" ? body.ideaText : undefined;
    const result = await continueFanficProject(storyId, {
      ...options.commandOptions,
      rootDir: options.rootDir,
      ideaText,
      maxSteps,
    });
    const snapshot = await createFanficUiSnapshot(storyId, { rootDir: options.rootDir });
    sendJson(res, 200, {
      ok: true,
      executedCommands: result.executedCommands,
      nextAction: result.nextAction,
      stoppedReason: result.stoppedReason,
      state: result.state,
      snapshot,
    });
    return;
  }

  if (url.pathname === "/api/fanfic/action" && req.method === "POST") {
    const body = await readJsonBody(req);
    const storyId = readStoryId(body);
    const command = readCommand(body);
    const ideaText = typeof body.ideaText === "string" ? body.ideaText : undefined;
    const snapshot = await runFanficUiAction(storyId, command, {
      ...options.commandOptions,
      rootDir: options.rootDir,
      ideaText,
    });
    sendJson(res, 200, { ok: true, snapshot });
    return;
  }

  if (url.pathname === "/api/fanfic/story-card" && req.method === "POST") {
    const body = await readJsonBody(req);
    const storyId = readStoryId(body);
    const snapshot = await patchFanficUiStoryCard(storyId, {
      target: readPatchTarget(body),
      field: readPatchField(body),
      value: body.value,
    }, { rootDir: options.rootDir });
    sendJson(res, 200, { ok: true, snapshot });
    return;
  }

  sendText(res, 404, "Not found");
}

async function serveStatic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  options: FanficPreviewServerOptions,
): Promise<void> {
  const filePath = resolveRequestPath(url.pathname, options.docsDir, options.entry);
  if (!filePath) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const stat = await fs.stat(filePath);
    const finalPath = stat.isDirectory() ? path.join(filePath, options.entry) : filePath;
    const body = await fs.readFile(finalPath);
    const ext = path.extname(finalPath);
    res.writeHead(200, {
      "content-type": MIME_TYPES[ext] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    if (req.method === "HEAD") res.end();
    else res.end(body);
  } catch {
    sendText(res, 404, "Not found");
  }
}

function resolveRequestPath(urlPath: string, docsDir: string, entry: string): string | null {
  const cleanPath = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  const relativePath = cleanPath === "/" ? entry : cleanPath.replace(/^\/+/, "");
  const resolved = path.resolve(docsDir, relativePath);
  if (!resolved.startsWith(docsDir + path.sep) && resolved !== docsDir) return null;
  return resolved;
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function readStoryId(body: Record<string, unknown>): string {
  if (typeof body.storyId !== "string" || body.storyId.trim() === "") {
    return "ui-workspace";
  }
  return body.storyId.trim();
}

function readMaxSteps(body: Record<string, unknown>): number {
  const value = body.maxSteps ?? 1;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error("maxSteps must be a positive integer");
  }
  return value;
}

function readCommand(body: Record<string, unknown>): FanficCommand {
  if (typeof body.command !== "string" || body.command.trim() === "") {
    throw new Error("command is required");
  }
  return body.command as FanficCommand;
}

function readPatchTarget(body: Record<string, unknown>): "idea" | "canon" {
  if (body.target === "idea" || body.target === "canon") return body.target;
  throw new Error("target must be idea or canon");
}

function readPatchField(body: Record<string, unknown>): string {
  if (typeof body.field !== "string" || body.field.trim() === "") {
    throw new Error("field is required");
  }
  return body.field.trim();
}

function sendJson(res: http.ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}

function sendText(res: http.ServerResponse, status: number, text: string): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  res.end(text);
}

function statusForError(error: unknown): number {
  const message = messageForError(error);
  if (/not found/i.test(message)) return 404;
  if (/not allowed|requires|invalid|must|command is required|json/i.test(message)) return 400;
  return 500;
}

function messageForError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
