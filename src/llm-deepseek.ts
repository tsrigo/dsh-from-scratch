import type {
  AssistantMessage,
  JsonValue,
  Llm,
  LlmResponse,
  ModelMessage,
  UnifiedRequest,
} from "./protocol.js";

interface DeepSeekToolCall {
  id: string;
  function: { name: string; arguments: string };
}

interface DeepSeekResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: DeepSeekToolCall[];
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

export interface DeepSeekLlmOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export class DeepSeekLlm implements Llm {
  readonly provider = "deepseek";
  readonly model: string;
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: DeepSeekLlmOptions) {
    this.#apiKey = options.apiKey;
    this.model = options.model ?? "deepseek-v4-flash";
    this.#baseUrl = (options.baseUrl ?? "https://api.deepseek.com").replace(/\/$/, "");
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async complete(request: UnifiedRequest): Promise<LlmResponse> {
    const response = await this.#fetch(`${this.#baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.#apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        temperature: 0,
        thinking: { type: "disabled" },
        messages: [
          { role: "system", content: request.system },
          ...request.messages.flatMap(toDeepSeekMessages),
          ...(request.dynamicContext
            ? [{ role: "system", content: `[Step context]\n${request.dynamicContext}` }]
            : []),
        ],
        tools: request.tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        })),
        tool_choice: "auto",
      }),
    });
    const body = (await response.json()) as DeepSeekResponse;
    if (!response.ok) {
      throw new Error(`DeepSeek request failed (${response.status}): ${body.error?.message ?? "unknown error"}`);
    }
    const raw = body.choices?.[0]?.message;
    if (!raw) throw new Error("DeepSeek returned no assistant message.");

    const message: AssistantMessage = {
      role: "assistant",
      content: raw.content ?? "",
      toolCalls: (raw.tool_calls ?? []).map((call) => ({
        id: call.id,
        name: call.function.name,
        arguments: parseArguments(call.function.arguments),
      })),
    };
    return {
      message,
      providerMetadata: {
        promptTokens: body.usage?.prompt_tokens ?? null,
        completionTokens: body.usage?.completion_tokens ?? null,
      },
    };
  }
}

function toDeepSeekMessages(message: ModelMessage): Array<Record<string, unknown>> {
  if (message.role === "system") return [{ role: "system", content: message.content }];
  if (message.role === "user") return [{ role: "user", content: message.content }];
  if (message.role === "tool") {
    return [{ role: "tool", tool_call_id: message.toolCallId, content: message.content }];
  }
  return [{
    role: "assistant",
    content: message.content || null,
    ...(message.toolCalls.length > 0
      ? {
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: JSON.stringify(call.arguments) },
          })),
        }
      : {}),
  }];
}

function parseArguments(value: string): JsonValue {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as JsonValue;
    }
  } catch {
    // Invalid arguments still enter the Agent Loop and become a tool error result.
  }
  return { $invalidJson: value };
}
