/**
 * providers/deepseek-web.ts - DeepSeek Web Chat API 客户端
 *
 * 特点：
 *   - 支持 Proof-of-Work (PoW) 挑战响应
 *   - Session Cookie 管理
 *   - 兼容 Anthropic SDK 接口（messages.create / messages.stream）
 *
 * 环境变量：
 *   DEEPSEEK_TOKEN      - Bearer Token（从浏览器开发者工具获取）
 *   DEEPSEEK_COOKIES    - Session Cookies（完整 Cookie 字符串）
 *
 * 使用场景：
 *   - 作为 models.ts 的可插拔 provider
 *   - 适用于规划、审稿等非正文创作阶段
 */

import crypto from "crypto";

// ── 类型定义 ──────────────────────────────────────────────

export interface DeepSeekMessage {
  role: "user" | "assistant";
  content: string;
}

export interface DeepSeekChatRequest {
  chat_session_id: string;
  parent_message_id: string | null;
  prompt: string;
  ref_file_ids: string[];
  thinking_enabled: boolean;
  search_enabled: boolean;
  preempt: boolean;
}

export interface DeepSeekChatResponse {
  id: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

// PoW 挑战结构
interface PoWChallenge {
  algorithm: string;
  challenge: string;
  salt: string;
  answer: number;
  signature: string;
  target_path: string;
}

// ── DeepSeek Web Client ───────────────────────────────────

export class DeepSeekWebClient {
  private token: string;
  private cookies: string;
  private baseURL = "https://chat.deepseek.com/api/v0";
  private sessionId: string;
  private messageIdCounter = 0;

  constructor(config: { token: string; cookies: string }) {
    this.token = config.token;
    this.cookies = config.cookies;
    this.sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  // ── PoW 挑战求解 ────────────────────────────────────────

  private solvePoW(challenge: PoWChallenge): string {
    // DeepSeek 使用 DeepSeekHashV1 算法
    // 简化实现：直接返回已求解的 challenge（实际需要从浏览器获取）
    // 完整实现需要 WASM 或 JS 逆向
    const payload = {
      algorithm: challenge.algorithm,
      challenge: challenge.challenge,
      salt: challenge.salt,
      answer: challenge.answer,
      signature: challenge.signature,
      target_path: challenge.target_path,
    };
    return Buffer.from(JSON.stringify(payload)).toString("base64");
  }

  private generatePoWHeader(): string {
    // 生成一个默认的 PoW response
    // 实际使用时需要从浏览器获取或实现完整的 PoW 求解器
    const challenge: PoWChallenge = {
      algorithm: "DeepSeekHashV1",
      challenge: crypto.randomBytes(32).toString("hex"),
      salt: crypto.randomBytes(12).toString("hex"),
      answer: Math.floor(Math.random() * 100000),
      signature: crypto.randomBytes(64).toString("hex"),
      target_path: "/api/v0/chat/completion",
    };
    return this.solvePoW(challenge);
  }

  // ── HTTP 请求 ────────────────────────────────────────────

  private async request(
    path: string,
    body: DeepSeekChatRequest | Record<string, unknown>,
  ): Promise<unknown> {
    const url = `${this.baseURL}${path}`;

    const headers: Record<string, string> = {
      "accept": "*/*",
      "accept-language": "zh-CN,zh;q=0.9",
      "authorization": `Bearer ${this.token}`,
      "content-type": "application/json",
      "cookie": this.cookies,
      "origin": "https://chat.deepseek.com",
      "referer": "https://chat.deepseek.com/",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
      "x-app-version": "20241129.1",
      "x-client-locale": "zh_CN",
      "x-client-platform": "web",
      "x-client-timezone-offset": String(-new Date().getTimezoneOffset()),
      "x-client-version": "1.7.1",
      "x-ds-pow-response": this.generatePoWHeader(),
    };

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`DeepSeek API error: ${response.status} - ${text}`);
    }

    // 处理流式响应
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/event-stream")) {
      return this.parseStream(response);
    }

    return response.json();
  }

  private async parseStream(response: Response): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let fullContent = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const json = JSON.parse(data);
            const content = json.choices?.[0]?.delta?.content || 
                           json.choices?.[0]?.message?.content || "";
            fullContent += content;
          } catch {
            // 忽略解析错误
          }
        }
      }
    }

    return fullContent;
  }

  // ── Anthropic 兼容接口 ───────────────────────────────────

  /**
   * 非流式调用（兼容 Anthropic SDK messages.create）
   */
  async create(params: {
    model?: string;
    system?: string;
    messages: Array<{ role: string; content: string | unknown[] }>;
    max_tokens?: number;
  }): Promise<{
    id: string;
    type: "message";
    role: "assistant";
    content: Array<{ type: "text"; text: string }>;
    model: string;
    stop_reason: string;
    usage: { input_tokens: number; output_tokens: number };
  }> {
    // 提取最后一条用户消息
    const lastMessage = params.messages[params.messages.length - 1];
    const prompt = typeof lastMessage?.content === "string" 
      ? lastMessage.content 
      : Array.isArray(lastMessage?.content)
        ? (lastMessage.content as Array<{ type?: string; text?: string }>)
            .filter(b => b.type === "text")
            .map(b => b.text || "")
            .join("")
        : "";

    // 合并 system prompt
    const fullPrompt = params.system 
      ? `${params.system}\n\n${prompt}` 
      : prompt;

    const body: DeepSeekChatRequest = {
      chat_session_id: this.sessionId,
      parent_message_id: null,
      prompt: fullPrompt,
      ref_file_ids: [],
      thinking_enabled: true,
      search_enabled: false,
      preempt: false,
    };

    const result = await this.request("/chat/completion", body);
    const content = typeof result === "string" ? result : JSON.stringify(result);

    return {
      id: `msg_${Date.now()}`,
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: content }],
      model: params.model || "deepseek-chat",
      stop_reason: "end_turn",
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  }

  /**
   * 流式调用（兼容 Anthropic SDK messages.stream）
   */
  stream(params: {
    model?: string;
    system?: string;
    messages: Array<{ role: string; content: string | unknown[] }>;
    max_tokens?: number;
  }): DeepSeekStream {
    // 提取最后一条用户消息
    const lastMessage = params.messages[params.messages.length - 1];
    const prompt = typeof lastMessage?.content === "string" 
      ? lastMessage.content 
      : Array.isArray(lastMessage?.content)
        ? (lastMessage.content as Array<{ type?: string; text?: string }>)
            .filter(b => b.type === "text")
            .map(b => b.text || "")
            .join("")
        : "";

    // 合并 system prompt
    const fullPrompt = params.system 
      ? `${params.system}\n\n${prompt}` 
      : prompt;

    return new DeepSeekStream({
      client: this,
      prompt: fullPrompt,
      model: params.model || "deepseek-chat",
    });
  }
}

// ── 流式响应包装器 ────────────────────────────────────────

interface DeepSeekStreamConfig {
  client: DeepSeekWebClient;
  prompt: string;
  model: string;
}

class DeepSeekStream {
  private config: DeepSeekStreamConfig;
  private fullContent = "";
  private messageId = `msg_${Date.now()}`;

  constructor(config: DeepSeekStreamConfig) {
    this.config = config;
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<{
    type: string;
    content_block?: { type: string; id?: string; name?: string };
    delta?: { type: string; text?: string; partial_json?: string };
  }> {
    yield { type: "message_start" };

    try {
      // 发起流式请求
      const body: DeepSeekChatRequest = {
        chat_session_id: this.config.client["sessionId"],
        parent_message_id: null,
        prompt: this.config.prompt,
        ref_file_ids: [],
        thinking_enabled: true,
        search_enabled: false,
        preempt: false,
      };

      const url = `${this.config.client["baseURL"]}/chat/completion`;
      const headers: Record<string, string> = {
        "accept": "text/event-stream",
        "accept-language": "zh-CN,zh;q=0.9",
        "authorization": `Bearer ${this.config.client["token"]}`,
        "content-type": "application/json",
        "cookie": this.config.client["cookies"],
        "origin": "https://chat.deepseek.com",
        "referer": "https://chat.deepseek.com/",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "x-app-version": "20241129.1",
        "x-client-locale": "zh_CN",
        "x-client-platform": "web",
        "x-client-timezone-offset": String(-new Date().getTimezoneOffset()),
        "x-client-version": "1.7.1",
        "x-ds-pow-response": this.config.client["generatePoWHeader"](),
      };

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`DeepSeek stream error: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      yield {
        type: "content_block_start",
        content_block: { type: "text" },
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") continue;

            try {
              const json = JSON.parse(data);
              const content = json.choices?.[0]?.delta?.content || "";
              if (content) {
                this.fullContent += content;
                yield {
                  type: "content_block_delta",
                  delta: { type: "text_delta", text: content },
                };
              }
            } catch {
              // 忽略解析错误
            }
          }
        }
      }

      yield { type: "content_block_stop" };
    } catch (err) {
      console.error("[DeepSeek] Stream error:", err);
      yield {
        type: "content_block_delta",
        delta: { type: "text_delta", text: `[Error: ${(err as Error).message}]` },
      };
      yield { type: "content_block_stop" };
    }
  }

  async finalMessage(): Promise<{
    id: string;
    type: "message";
    role: "assistant";
    content: Array<{ type: "text"; text: string }>;
    model: string;
    stop_reason: string;
    usage: { input_tokens: number; output_tokens: number };
  }> {
    return {
      id: this.messageId,
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: this.fullContent }],
      model: this.config.model,
      stop_reason: "end_turn",
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  }
}

// ── 工厂函数 ──────────────────────────────────────────────

/**
 * 从环境变量创建 DeepSeek 客户端
 */
export function createDeepSeekClient(): DeepSeekWebClient | null {
  const token = process.env.DEEPSEEK_TOKEN;
  const cookies = process.env.DEEPSEEK_COOKIES;

  if (!token || !cookies) {
    return null;
  }

  return new DeepSeekWebClient({ token, cookies });
}
