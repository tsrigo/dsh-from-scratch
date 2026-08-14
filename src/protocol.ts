export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface ToolCall {
  id: string;
  name: string;
  arguments: JsonValue;
}

export interface UserMessage {
  role: "user";
  content: string;
}

export interface SystemMessage {
  role: "system";
  content: string;
}

export interface AssistantMessage {
  role: "assistant";
  content: string;
  toolCalls: ToolCall[];
}

export interface ToolMessage {
  role: "tool";
  toolCallId: string;
  name: string;
  content: string;
}

export type ModelMessage = SystemMessage | UserMessage | AssistantMessage | ToolMessage;

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface UnifiedRequest {
  system: string;
  tools: ToolSchema[];
  messages: ModelMessage[];
  dynamicContext: string;
}

export interface LlmResponse {
  message: AssistantMessage;
  providerMetadata?: Record<string, JsonValue>;
}

export type LlmStreamEvent =
  | { type: "content-delta"; content: string }
  | {
      type: "tool-call-delta";
      index: number;
      id?: string;
      name?: string;
      arguments: string;
    }
  | { type: "response"; response: LlmResponse };

export interface Llm {
  readonly provider: string;
  readonly model: string;
  stream(request: UnifiedRequest): AsyncIterable<LlmStreamEvent>;
}

export interface ToolDefinition extends ToolSchema {
  execute(input: JsonValue): Promise<JsonValue> | JsonValue;
}
