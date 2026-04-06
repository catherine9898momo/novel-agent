import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  OpenAICompatibleClient,
  type AnthropicResponse,
  type AnthropicStreamEvent,
} from "../../src/providers/openai-compatible.js";

// ── Helper: 访问内部转换函数（通过 client 实例间接测试）──

function makeClient(): OpenAICompatibleClient {
  return new OpenAICompatibleClient({
    apiKey: "test-key",
    baseURL: "https://api.example.com",
  });
}

describe("OpenAI Compatible Provider", () => {
  describe("OpenAICompatibleClient 构造", () => {
    it("正确初始化并标准化 baseURL", () => {
      const c1 = new OpenAICompatibleClient({ apiKey: "k", baseURL: "https://api.example.com/" });
      expect(c1.baseURL).toBe("https://api.example.com");

      const c2 = new OpenAICompatibleClient({ apiKey: "k", baseURL: "https://api.example.com/v1" });
      expect(c2.baseURL).toBe("https://api.example.com");

      const c3 = new OpenAICompatibleClient({ apiKey: "k", baseURL: "https://api.example.com/v1/" });
      expect(c3.baseURL).toBe("https://api.example.com");
    });

    it("暴露 messages 对象", () => {
      const client = makeClient();
      expect(client.messages).toBeDefined();
      expect(typeof client.messages.create).toBe("function");
      expect(typeof client.messages.stream).toBe("function");
    });
  });

  describe("messages.create() - 非流式调用", () => {
    it("发送正确格式的请求并转换响应", async () => {
      const client = makeClient();

      // Mock fetch
      const mockResponse = {
        ok: true,
        json: async () => ({
          id: "chatcmpl-123",
          choices: [{
            index: 0,
            message: { role: "assistant", content: "Hello!" },
            finish_reason: "stop",
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          model: "gpt-4",
        }),
      };
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse as Response);

      const result = await client.messages.create({
        model: "gpt-4",
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 100,
      });

      // 验证请求格式
      const fetchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(fetchCall[0]).toBe("https://api.example.com/v1/chat/completions");
      const body = JSON.parse(fetchCall[1].body);
      expect(body.model).toBe("gpt-4");
      expect(body.messages).toEqual([{ role: "user", content: "Hi" }]);
      expect(body.max_tokens).toBe(100);
      expect(fetchCall[1].headers.Authorization).toBe("Bearer test-key");

      // 验证响应格式
      expect(result.id).toBe("chatcmpl-123");
      expect(result.type).toBe("message");
      expect(result.role).toBe("assistant");
      expect(result.content).toEqual([{ type: "text", text: "Hello!" }]);
      expect(result.stop_reason).toBe("end_turn");
      expect(result.usage.input_tokens).toBe(10);
      expect(result.usage.output_tokens).toBe(5);
    });

    it("system 参数转换为 system role 消息", async () => {
      const client = makeClient();

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "chatcmpl-123",
          choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
        }),
      } as Response);

      await client.messages.create({
        model: "test",
        system: "You are a helpful assistant",
        messages: [{ role: "user", content: "Hi" }],
      });

      const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.messages[0]).toEqual({ role: "system", content: "You are a helpful assistant" });
      expect(body.messages[1]).toEqual({ role: "user", content: "Hi" });
    });

    it("tool_use 和 tool_result 正确转换", async () => {
      const client = makeClient();

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "chatcmpl-123",
          choices: [{
            index: 0,
            message: {
              role: "assistant",
              content: "Done",
              tool_calls: [{
                id: "call_abc",
                type: "function",
                function: { name: "get_weather", arguments: '{"city":"Beijing"}' },
              }],
            },
            finish_reason: "tool_calls",
          }],
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        }),
      } as Response);

      const result = await client.messages.create({
        model: "test",
        messages: [
          { role: "user", content: "What's the weather?" },
          {
            role: "assistant",
            content: [
              { type: "tool_use", id: "call_abc", name: "get_weather", input: { city: "Beijing" } },
            ],
          },
          {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "call_abc", content: "Sunny, 25°C" }],
          },
        ],
        tools: [{
          name: "get_weather",
          description: "Get weather",
          input_schema: { type: "object", properties: { city: { type: "string" } } },
        }],
      });

      // 验证请求中的消息转换
      const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);

      // tool_use → tool_calls
      expect(body.messages[1]).toEqual({
        role: "assistant",
        content: "",
        tool_calls: [{
          id: "call_abc",
          type: "function",
          function: { name: "get_weather", arguments: '{"city":"Beijing"}' },
        }],
      });

      // tool_result → role: "tool"
      expect(body.messages[2]).toEqual({
        role: "tool",
        tool_call_id: "call_abc",
        content: "Sunny, 25°C",
      });

      // 工具定义转换
      expect(body.tools).toEqual([{
        type: "function",
        function: {
          name: "get_weather",
          description: "Get weather",
          parameters: { type: "object", properties: { city: { type: "string" } } },
        },
      }]);

      // 响应转换：tool_calls → tool_use
      expect(result.stop_reason).toBe("tool_use");
      expect(result.content[1]).toEqual({
        type: "tool_use",
        id: "call_abc",
        name: "get_weather",
        input: { city: "Beijing" },
      });
    });

    it("HTTP 错误抛出带 status 的异常", async () => {
      const client = makeClient();
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => '{"error":"invalid token"}',
      } as Response);

      await expect(client.messages.create({
        model: "test",
        messages: [{ role: "user", content: "Hi" }],
      })).rejects.toThrow("401");
    });
  });

  describe("messages.stream() - 流式调用", () => {
    it("正确解析 SSE 并生成 Anthropic 格式事件", async () => {
      const client = makeClient();

      // 构造模拟的 SSE 响应
      const sseChunks = [
        'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
        'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
        'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}\n\n',
        'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ];

      const encoder = new TextEncoder();
      const readableStream = new ReadableStream({
        start(controller) {
          for (const chunk of sseChunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        body: readableStream,
      } as Response);

      const stream = client.messages.stream({
        model: "test",
        messages: [{ role: "user", content: "Hi" }],
      });

      const events: AnthropicStreamEvent[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      // 验证事件序列
      expect(events[0].type).toBe("message_start");
      expect(events[1].type).toBe("content_block_start");
      expect(events[1].content_block?.type).toBe("text");
      expect(events[2]).toEqual({ type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } });
      expect(events[3]).toEqual({ type: "content_block_delta", delta: { type: "text_delta", text: " world" } });
      expect(events[4].type).toBe("content_block_stop");

      // 验证 finalMessage
      const final = await stream.finalMessage();
      expect(final.content[0]).toEqual({ type: "text", text: "Hello world" });
      expect(final.stop_reason).toBe("end_turn");
    });

    it("正确处理流式工具调用", async () => {
      const client = makeClient();

      const sseChunks = [
        'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
        'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"test_tool","arguments":""}}]},"finish_reason":null}]}\n\n',
        'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"key\\""}}]},"finish_reason":null}]}\n\n',
        'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\\"val\\"}"}}]},"finish_reason":null}]}\n\n',
        'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n',
        'data: [DONE]\n\n',
      ];

      const encoder = new TextEncoder();
      const readableStream = new ReadableStream({
        start(controller) {
          for (const chunk of sseChunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        body: readableStream,
      } as Response);

      const stream = client.messages.stream({
        model: "test",
        messages: [{ role: "user", content: "Run tool" }],
        tools: [{ name: "test_tool", description: "Test", input_schema: { type: "object" } }],
      });

      const events: AnthropicStreamEvent[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      // message_start, content_block_start(tool_use), 2x input_json_delta, content_block_stop
      expect(events[0].type).toBe("message_start");
      expect(events[1].type).toBe("content_block_start");
      expect(events[1].content_block?.type).toBe("tool_use");
      expect(events[1].content_block?.id).toBe("call_1");
      expect(events[1].content_block?.name).toBe("test_tool");

      const final = await stream.finalMessage();
      expect(final.stop_reason).toBe("tool_use");
      expect(final.content[0]).toEqual({
        type: "tool_use",
        id: "call_1",
        name: "test_tool",
        input: { key: "val" },
      });
    });
  });

  describe("格式转换边界情况", () => {
    it("空文本 + 只有工具调用的响应", async () => {
      const client = makeClient();
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "chatcmpl-123",
          choices: [{
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{
                id: "call_1",
                type: "function",
                function: { name: "run", arguments: "{}" },
              }],
            },
            finish_reason: "tool_calls",
          }],
        }),
      } as Response);

      const result = await client.messages.create({
        model: "test",
        messages: [{ role: "user", content: "Go" }],
      });

      expect(result.content).toEqual([{
        type: "tool_use",
        id: "call_1",
        name: "run",
        input: {},
      }]);
      expect(result.stop_reason).toBe("tool_use");
    });

    it("assistant 消息混合文本和 tool_use 的转换", async () => {
      const client = makeClient();

      // 这里的测试是验证 convertMessages 对混合内容的处理
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "chatcmpl-123",
          choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
        }),
      } as Response);

      await client.messages.create({
        model: "test",
        messages: [{
          role: "assistant",
          content: [
            { type: "text", text: "Let me check" },
            { type: "tool_use", id: "tu_1", name: "search", input: { q: "test" } },
          ],
        }],
      });

      const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.messages[0]).toEqual({
        role: "assistant",
        content: "Let me check",
        tool_calls: [{
          id: "tu_1",
          type: "function",
          function: { name: "search", arguments: '{"q":"test"}' },
        }],
      });
    });
  });
});
