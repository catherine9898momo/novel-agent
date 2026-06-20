import type { ModelEndpoint } from "../models.js";

interface JsonTextRequest {
  maxTokens: number;
  system: string;
  content: string;
}

interface TextBlock {
  type: string;
  text?: string;
}

interface TextMessageResponse {
  content: TextBlock[];
}

type MessageCreate = (params: Record<string, unknown>) => Promise<TextMessageResponse>;

export async function requestJsonText(endpoint: ModelEndpoint, request: JsonTextRequest): Promise<string> {
  const body: Record<string, unknown> = {
    model: endpoint.model,
    max_tokens: request.maxTokens,
    system: request.system,
    messages: [{ role: "user", content: request.content }],
  };

  if (endpoint.provider === "openai-compatible") {
    body.response_format = { type: "json_object" };
  }

  const create = endpoint.client.messages.create.bind(endpoint.client.messages) as unknown as MessageCreate;
  const response = await create(body);
  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("")
    .trim();
}
