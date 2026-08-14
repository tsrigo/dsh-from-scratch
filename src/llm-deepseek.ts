import type {
  AssistantMessage,
  JsonValue,
  Llm,
  LlmResponse,
  LlmStreamEvent,
  ModelMessage,
  UnifiedRequest,
} from "./protocol.js";

interface DeepSeekStreamPayload {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
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

  async *stream(request: UnifiedRequest): AsyncIterable<LlmStreamEvent> {
    const response = await this.#fetch(`${this.#baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.#apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        stream: true,
        stream_options: { include_usage: true },
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
    if (!response.ok) {
      const message = await responseErrorMessage(response);
      throw new Error(`DeepSeek request failed (${response.status}): ${message}`);
    }
    if (!response.body) throw new Error("DeepSeek returned an empty streaming response.");

    let content = "";
    let usage: DeepSeekStreamPayload["usage"];
    let done = false;
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();

    for await (const data of parseServerSentEvents(response.body)) {
      if (data === "[DONE]") {
        done = true;
        break;
      }
      let payload: DeepSeekStreamPayload;
      try {
        payload = JSON.parse(data) as DeepSeekStreamPayload;
      } catch {
        throw new Error("DeepSeek returned malformed JSON in its event stream.");
      }
      if (payload.error) throw new Error(`DeepSeek stream failed: ${payload.error.message ?? "unknown error"}`);
      if (payload.usage) usage = payload.usage;
      const delta = payload.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.content) {
        content += delta.content;
        yield { type: "content-delta", content: delta.content };
      }
      for (const call of delta.tool_calls ?? []) {
        const current = toolCalls.get(call.index) ?? { id: "", name: "", arguments: "" };
        if (call.id) current.id += call.id;
        if (call.function?.name) current.name += call.function.name;
        const argumentDelta = call.function?.arguments ?? "";
        current.arguments += argumentDelta;
        toolCalls.set(call.index, current);
        yield {
          type: "tool-call-delta",
          index: call.index,
          ...(call.id ? { id: call.id } : {}),
          ...(call.function?.name ? { name: call.function.name } : {}),
          arguments: argumentDelta,
        };
      }
    }
    if (!done) throw new Error("DeepSeek event stream ended before [DONE].");

    const message: AssistantMessage = {
      role: "assistant",
      content,
      toolCalls: [...toolCalls.entries()]
        .sort(([left], [right]) => left - right)
        .map(([index, call]) => {
          if (!call.id || !call.name) {
            throw new Error(`DeepSeek tool call ${index} is missing its id or name.`);
          }
          return {
            id: call.id,
            name: call.name,
            arguments: parseArguments(call.arguments),
          };
        }),
    };
    const completed: LlmResponse = {
      message,
      providerMetadata: {
        promptTokens: usage?.prompt_tokens ?? null,
        completionTokens: usage?.completion_tokens ?? null,
      },
    };
    yield { type: "response", response: completed };
  }
}

export async function* parseServerSentEvents(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const normalized = buffer.replace(/\r\n/gu, "\n");
      const blocks = normalized.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /u, ""))
          .join("\n");
        if (data) yield data;
      }
      if (done) break;
    }
    const trailing = buffer.trim();
    if (trailing) {
      const data = trailing
        .split(/\r?\n/u)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /u, ""))
        .join("\n");
      if (data) yield data;
    }
  } finally {
    reader.releaseLock();
  }
}

async function responseErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as DeepSeekStreamPayload;
    return body.error?.message ?? "unknown error";
  } catch {
    return text.trim() || "unknown error";
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
