/**
 * providers/openai-compatible.ts - OpenAI 兼容 API 适配器
 *
 * 将 OpenAI Chat Completions API 包装为 Anthropic SDK 兼容接口。
 * 适用于只接受 Authorization: Bearer 认证的中转服务（如 xh.v1api.cc）。
 *
 * 对外暴露与 Anthropic SDK 相同的接口：
 *   - client.messages.create(params) → response
 *   - client.messages.stream(params) → async iterable + finalMessage()
 *
 * 格式转换：
 *   - Anthropic system 参数 → OpenAI system role 消息
 *   - Anthropic tool_result → OpenAI role: "tool" 消息
 *   - Anthropic tool_use → OpenAI tool_calls
 *   - OpenAI finish_reason: "tool_calls" → Anthropic stop_reason: "tool_use"
 */

// ── Anthropic 兼容类型 ───────────────────────────────────

export interface AnthropicResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

export interface AnthropicStreamEvent {
  type: string;
  content_block?: { type: string; id?: string; name?: string };
  delta?: { type: string; text?: string; partial_json?: string };
}

// ── OpenAI 类型 ──────────────────────────────────────────

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAITool {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

interface OpenAIResponse {
  id: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content?: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  model?: string;
}

interface OpenAIStreamChunk {
  id: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason: string | null;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

// ── Anthropic 输入参数类型 ────────────────────────────────

interface AnthropicMessageParam {
  role: "user" | "assistant";
  content: string | AnthropicContentBlockParam[];
}

type AnthropicContentBlockParam =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface AnthropicToolParam {
  name: string;
  description: string;
  input_schema: unknown;
}

interface AnthropicCreateParams {
  model: string;
  system?: string;
  messages: AnthropicMessageParam[];
  tools?: AnthropicToolParam[];
  max_tokens?: number;
}

// ── 格式转换 ─────────────────────────────────────────────

function convertMessages(messages: AnthropicMessageParam[], system?: string): OpenAIMessage[] {
  const result: OpenAIMessage[] = [];

  if (system) {
    result.push({ role: "system", content: system });
  }

  for (const msg of messages) {
    if (typeof msg.content === "string") {
      result.push({ role: msg.role, content: msg.content });
      continue;
    }

    // 处理 content blocks
    const textParts: string[] = [];
    const toolUseParts: { id: string; name: string; input: unknown }[] = [];
    const toolResultParts: { tool_use_id: string; content: string }[] = [];

    for (const block of msg.content as AnthropicContentBlockParam[]) {
      if (block.type === "text") {
        textParts.push(block.text);
      } else if (block.type === "tool_use") {
        toolUseParts.push({ id: block.id, name: block.name, input: block.input });
      } else if (block.type === "tool_result") {
        toolResultParts.push({ tool_use_id: block.tool_use_id, content: block.content });
      }
    }

    if (msg.role === "assistant") {
      const assistantMsg: OpenAIMessage = { role: "assistant", content: textParts.join("") || null };
      if (toolUseParts.length > 0) {
        assistantMsg.tool_calls = toolUseParts.map(t => ({
          id: t.id,
          type: "function" as const,
          function: { name: t.name, arguments: JSON.stringify(t.input) },
        }));
      }
      result.push(assistantMsg);
    } else if (msg.role === "user") {
      if (toolResultParts.length > 0) {
        // Anthropic 的 tool_result 包在 user message 里
        // OpenAI 需要 role: "tool" 消息
        for (const tr of toolResultParts) {
          result.push({ role: "tool", tool_call_id: tr.tool_use_id, content: tr.content });
        }
      } else {
        result.push({ role: "user", content: textParts.join("") });
      }
    }
  }

  return result;
}

function convertTools(tools?: AnthropicToolParam[]): OpenAITool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map(t => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

function convertStopReason(finishReason: string | null): string | null {
  if (finishReason === "tool_calls") return "tool_use";
  if (finishReason === "stop") return "end_turn";
  if (finishReason === "length") return "max_tokens";
  return finishReason;
}

function convertResponse(oai: OpenAIResponse, model: string): AnthropicResponse {
  const choice = oai.choices?.[0];
  const content: AnthropicContentBlock[] = [];

  if (choice?.message?.content) {
    content.push({ type: "text", text: choice.message.content });
  }

  if (choice?.message?.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      content.push({
        type: "tool_use",
        id: tc.id,
        name: tc.function.name,
        input: JSON.parse(tc.function.arguments),
      });
    }
  }

  return {
    id: oai.id,
    type: "message",
    role: "assistant",
    content,
    model: oai.model || model,
    stop_reason: convertStopReason(choice?.finish_reason ?? null),
    stop_sequence: null,
    usage: {
      input_tokens: oai.usage?.prompt_tokens ?? 0,
      output_tokens: oai.usage?.completion_tokens ?? 0,
    },
  };
}

// ── OpenAI Compatible Client ─────────────────────────────

export class OpenAICompatibleClient {
  public readonly messages: OpenAICompatibleMessages;
  public readonly baseURL: string;
  private readonly apiKey: string;

  constructor(config: { apiKey: string; baseURL: string }) {
    this.apiKey = config.apiKey;
    // 标准化 baseURL：去掉尾部斜杠和 /v1 后缀
    this.baseURL = config.baseURL.replace(/\/+$/, "").replace(/\/v1$/, "");
    this.messages = new OpenAICompatibleMessages(this);
  }

  get apiKey_public(): string {
    return this.apiKey;
  }

  async request(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    const url = `${this.baseURL}/v1/chat/completions`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.apiKey}`,
    };

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const err = new Error(`${response.status} ${text.slice(0, 200)}`);
      (err as Error & { status?: number }).status = response.status;
      throw err;
    }

    return response;
  }
}

class OpenAICompatibleMessages {
  private client: OpenAICompatibleClient;

  constructor(client: OpenAICompatibleClient) {
    this.client = client;
  }

  async create(params: AnthropicCreateParams): Promise<AnthropicResponse> {
    const body: Record<string, unknown> = {
      model: params.model,
      messages: convertMessages(params.messages, params.system),
      max_tokens: params.max_tokens ?? 4096,
    };

    const tools = convertTools(params.tools);
    if (tools) body.tools = tools;

    const response = await this.client.request(body);
    const data = await response.json() as OpenAIResponse;
    return convertResponse(data, params.model);
  }

  stream(params: AnthropicCreateParams & { signal?: AbortSignal }, options?: { signal?: AbortSignal }): OpenAICompatibleStream {
    const signal = params.signal ?? options?.signal;
    return new OpenAICompatibleStream(this.client, { ...params, signal });
  }
}

// ── 流式响应包装器 ────────────────────────────────────────

class OpenAICompatibleStream {
  private client: OpenAICompatibleClient;
  private params: AnthropicCreateParams & { signal?: AbortSignal };
  private fullContent = "";
  private aggregatedToolCalls = new Map<number, { id: string; name: string; arguments: string }>();
  private usage: { input_tokens: number; output_tokens: number } = { input_tokens: 0, output_tokens: 0 };
  private stopReason: string | null = null;
  private model: string;
  private messageId: string;

  constructor(client: OpenAICompatibleClient, params: AnthropicCreateParams & { signal?: AbortSignal }) {
    this.client = client;
    this.params = params;
    this.model = params.model;
    this.messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<AnthropicStreamEvent> {
    const body: Record<string, unknown> = {
      model: this.params.model,
      messages: convertMessages(this.params.messages, this.params.system),
      max_tokens: this.params.max_tokens ?? 4096,
      stream: true,
    };

    const tools = convertTools(this.params.tools);
    if (tools) body.tools = tools;

    const response = await this.client.request(body, this.params.signal);

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    // 追踪当前活跃的 content block
    let textBlockOpen = false;
    const toolBlockState = new Map<number, boolean>(); // index -> block open?

    yield { type: "message_start" };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;

          let chunk: OpenAIStreamChunk;
          try {
            chunk = JSON.parse(data);
          } catch {
            continue;
          }

          const choice = chunk.choices?.[0];
          if (!choice) continue;

          // 处理 usage（有些 proxy 在最后一个 chunk 里返回）
          if (chunk.usage) {
            this.usage = {
              input_tokens: chunk.usage.prompt_tokens ?? 0,
              output_tokens: chunk.usage.completion_tokens ?? 0,
            };
          }

          const delta = choice.delta;

          // 文本内容
          if (delta?.content) {
            if (!textBlockOpen) {
              yield { type: "content_block_start", content_block: { type: "text" } };
              textBlockOpen = true;
            }
            this.fullContent += delta.content;
            yield { type: "content_block_delta", delta: { type: "text_delta", text: delta.content } };
          }

          // 工具调用
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;

              // 新工具调用开始
              if (tc.id && tc.function?.name) {
                // 先关闭之前的 text block
                if (textBlockOpen) {
                  yield { type: "content_block_stop" };
                  textBlockOpen = false;
                }
                // 关闭之前的 tool block（如果有）
                if (toolBlockState.get(idx - 1)) {
                  yield { type: "content_block_stop" };
                  toolBlockState.set(idx - 1, false);
                }

                yield {
                  type: "content_block_start",
                  content_block: { type: "tool_use", id: tc.id, name: tc.function.name },
                };
                toolBlockState.set(idx, true);
                this.aggregatedToolCalls.set(idx, { id: tc.id, name: tc.function.name, arguments: "" });
              }

              // 工具参数增量
              if (tc.function?.arguments) {
                const existing = this.aggregatedToolCalls.get(idx);
                if (existing) {
                  existing.arguments += tc.function.arguments;
                }
                yield {
                  type: "content_block_delta",
                  delta: { type: "input_json_delta", partial_json: tc.function.arguments },
                };
              }
            }
          }

          // finish_reason
          if (choice.finish_reason) {
            this.stopReason = convertStopReason(choice.finish_reason);
          }
        }
      }
    } finally {
      // 关闭所有打开的 block
      if (textBlockOpen) {
        yield { type: "content_block_stop" };
      }
      for (const [, isOpen] of toolBlockState) {
        if (isOpen) {
          yield { type: "content_block_stop" };
        }
      }
    }
  }

  async finalMessage(): Promise<AnthropicResponse> {
    const content: AnthropicContentBlock[] = [];

    if (this.fullContent) {
      content.push({ type: "text", text: this.fullContent });
    }

    for (const [, tc] of this.aggregatedToolCalls) {
      let input: unknown;
      try {
        input = JSON.parse(tc.arguments);
      } catch {
        input = {};
      }
      content.push({ type: "tool_use", id: tc.id, name: tc.name, input });
    }

    return {
      id: this.messageId,
      type: "message",
      role: "assistant",
      content,
      model: this.model,
      stop_reason: this.stopReason ?? "end_turn",
      stop_sequence: null,
      usage: this.usage,
    };
  }
}
