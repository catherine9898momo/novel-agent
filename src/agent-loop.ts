/**
 * agent-loop.ts - 核心 Agent 循环 (s01 概念)
 *
 * 核心模式：
 *   while stop_reason == "tool_use":
 *     response = LLM(messages, tools)
 *     execute tools
 *     append results
 */

import Anthropic from "@anthropic-ai/sdk"; // 引入官方 SDK，所有类型定义都从这里来
import { microCompress, autoCompress } from "./context-compact.js";

// 用 SDK 自带的类型，避免自己手写容易出错
export type Message = Anthropic.MessageParam;       // 一条对话消息，包含 role + content
export type Tool = Anthropic.Tool;                  // 工具定义，包含 name/description/input_schema
export type ToolHandler = (                         // 工具的执行函数类型
    input: Record<string, unknown>                  // input 是 LLM 传来的参数，类型不确定所以用 unknown
) => Promise<string> | string;                      // 返回字符串结果，可以是异步的（比如写文件）
export type ToolHandlers = Record<string, ToolHandler>; // 工具名 -> 执行函数 的映射表

export interface CompactOptions {
  threshold?: number;        // token 阈值，超过则触发 autoCompress（默认 80_000）
  enableMicro?: boolean;     // 是否启用微压缩
  keepLast?: number;         // 微压缩保留最近几条完整工具结果（默认 3）
  compressClient?: Anthropic; // 压缩专用 client（可指向便宜服务商，不传则用主 client）
  compressModel?: string;    // 压缩专用模型（可用便宜模型，不传则用主模型）
}

/**
 * @param client         - Anthropic SDK 实例，负责发 API 请求
 * @param model          - 模型 ID，比如 claude-sonnet-4-20250514
 * @param system         - system prompt，告诉 LLM 它是谁、能做什么
 * @param messages       - 对话历史，传引用是因为循环里要不断追加，调用方也能看到完整历史
 * @param tools          - 工具列表，告诉 LLM 有哪些工具可以用
 * @param handlers       - 工具的实际执行逻辑，key 是工具名
 * @param onToolCall     - 可选回调，每次工具执行后触发，用来打日志或显示进度
 * @param compactOptions - 可选压缩配置，不传则不启用压缩
 */
export async function agentLoop(
    client: Anthropic,
    model: string,
    system: string,
    messages: Message[],
    tools: Tool[],
    handlers: ToolHandlers,
    onToolCall?: (name: string, output: string) => void,
    compactOptions?: CompactOptions,
): Promise<void> {
    while (true) { // 无限循环，靠内部 return 退出——因为不知道 LLM 要调用几次工具
        const response = await client.messages.create({
            model,
            system,
            messages,
            tools,
            max_tokens: 8000, // 限制单次回复长度，小说内容可能很长所以给大一点
        });

        // 把 assistant 的回复追加到历史——下一轮请求需要带上，LLM 才知道自己上一步做了什么
        messages.push({ role: "assistant", content: response.content });

        // stop_reason 不是 "tool_use" 说明 LLM 认为任务完成了，退出循环
        if (response.stop_reason !== "tool_use") return;

        // 收集这一轮所有工具调用的结果，一次性返回给 LLM
        const results: Anthropic.ToolResultBlockParam[] = [];

        for (const block of response.content) { // response.content 可能包含文字和工具调用混合
            if (block.type !== "tool_use") continue; // 只处理工具调用，跳过纯文字 block

            const handler = handlers[block.name]; // 根据工具名找到对应的执行函数

            let output: string;
            try {
                output = handler
                    ? await handler(block.input as Record<string, unknown>)
                    : `Unknown tool: ${block.name}`;
            } catch (e) {
                output = `Error: ${e}`; // 工具执行失败，把错误告诉 LLM，让它决定怎么处理
            }

            onToolCall?.(block.name, output.slice(0, 200)); // 回调通知外部，截断是避免日志太长

            results.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: output,
            });
        }

        // 把所有工具结果作为 user 消息返回——API 规定工具结果必须放在 user role 里
        messages.push({ role: "user", content: results });

        // 每轮 push tool results 之后执行压缩
        if (compactOptions) {
            if (compactOptions.enableMicro) {
                microCompress(messages, compactOptions.keepLast);
            }
            const compressed = await autoCompress(
                compactOptions.compressClient ?? client,
                compactOptions.compressModel ?? model,
                messages,
                compactOptions.threshold,
            );
            if (compressed) console.log("[compact] 上下文已压缩");
        }
        // 循环继续，LLM 看到工具结果后决定下一步：继续调工具，或者结束
    }
}
